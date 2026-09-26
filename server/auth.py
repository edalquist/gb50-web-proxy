"""Authentication, authorization, password hashing, and user repository for GB-50 Proxy."""

from __future__ import annotations

import os
import time
import json
import base64
import hmac
import hashlib
import secrets
import sqlite3
from typing import Optional, Dict, Any, List
from datetime import datetime, timezone
from fastapi import Request, HTTPException, Depends, status, Query
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field

import logging

_logger = logging.getLogger("gb50.auth")

# Secret key for JWT signature
_env_secret = os.getenv("GB50_JWT_SECRET")
if _env_secret:
    JWT_SECRET = _env_secret
else:
    # Use deterministic key in dev or generate ephemeral secure secret
    JWT_SECRET = os.getenv("GB50_JWT_SECRET_FALLBACK", secrets.token_urlsafe(32))
    _logger.info("GB50_JWT_SECRET not provided; initialized secure secret key.")

JWT_ALGORITHM = "HS256"
_exp_hours_env = os.getenv("GB50_JWT_EXPIRATION_HOURS")
JWT_EXPIRATION_HOURS = int(_exp_hours_env) if _exp_hours_env and _exp_hours_env.isdigit() else 24 * 30  # Default 30 days session

# Default SQLite DB Path
DEFAULT_DB_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "gb50_users.db"
)
DB_PATH = os.getenv("GB50_DB_PATH", DEFAULT_DB_PATH)

security_bearer = HTTPBearer(auto_error=False)


# --- Cryptographic Utilities ---

def hash_password(password: str) -> str:
    """Hash password using PBKDF2-HMAC-SHA256 with dynamic salt."""
    salt = secrets.token_hex(16)
    iterations = 100000
    derived = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt.encode("utf-8"), iterations
    )
    return f"pbkdf2_sha256${iterations}${salt}${derived.hex()}"


def verify_password(password: str, hashed_str: str) -> bool:
    """Verify raw password against stored PBKDF2 hash."""
    try:
        parts = hashed_str.split("$")
        if len(parts) != 4 or parts[0] != "pbkdf2_sha256":
            return False
        iterations = int(parts[1])
        salt = parts[2]
        expected_hash = parts[3]
        derived = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), salt.encode("utf-8"), iterations
        )
        return hmac.compare_digest(derived.hex(), expected_hash)
    except Exception:
        return False


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(s: str) -> bytes:
    padding = 4 - (len(s) % 4)
    if padding != 4:
        s += "=" * padding
    return base64.urlsafe_b64decode(s.encode("ascii"))


def create_access_token(user: Dict[str, Any], expires_in_hours: int = JWT_EXPIRATION_HOURS) -> str:
    """Create a signed JWT token."""
    header = {"alg": "HS256", "typ": "JWT"}
    now = int(time.time())
    payload = {
        "sub": str(user["id"]),
        "username": user["username"],
        "role": user["role"],
        "display_name": user.get("display_name", user["username"]),
        "token_ver": user.get("token_version", 1),
        "iat": now,
        "exp": now + (expires_in_hours * 3600),
    }

    header_b64 = _b64url_encode(json.dumps(header).encode("utf-8"))
    payload_b64 = _b64url_encode(json.dumps(payload).encode("utf-8"))
    signing_input = f"{header_b64}.{payload_b64}"

    signature = hmac.new(
        JWT_SECRET.encode("utf-8"), signing_input.encode("utf-8"), hashlib.sha256
    ).digest()
    sig_b64 = _b64url_encode(signature)

    return f"{header_b64}.{payload_b64}.{sig_b64}"


def decode_access_token(token: str) -> Optional[Dict[str, Any]]:
    """Decode and verify signed JWT token."""
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return None
        header_b64, payload_b64, sig_b64 = parts
        signing_input = f"{header_b64}.{payload_b64}"

        expected_sig = hmac.new(
            JWT_SECRET.encode("utf-8"), signing_input.encode("utf-8"), hashlib.sha256
        ).digest()
        provided_sig = _b64url_decode(sig_b64)

        if not hmac.compare_digest(expected_sig, provided_sig):
            return None

        payload_bytes = _b64url_decode(payload_b64)
        payload = json.loads(payload_bytes.decode("utf-8"))

        if payload.get("exp", 0) < int(time.time()):
            return None  # Expired

        return payload
    except Exception:
        return None


# --- Database Repository ---

class UserDatabase:
    """SQLite User Repository with WAL concurrency support."""

    def __init__(self, db_path: str = DB_PATH):
        self.db_path = db_path
        db_dir = os.path.dirname(os.path.abspath(self.db_path))
        if db_dir:
            os.makedirs(db_dir, exist_ok=True)
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=5.0)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON;")
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA busy_timeout=5000;")
        return conn

    def init_db(self):
        """Public alias to initialize or seed database tables."""
        self._init_db()

    def _init_db(self):
        """Create tables and seed initial admin user if empty."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT UNIQUE NOT NULL,
                    password_hash TEXT NOT NULL,
                    role TEXT NOT NULL CHECK(role IN ('admin', 'operator', 'viewer')),
                    display_name TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    last_login TEXT,
                    enabled INTEGER NOT NULL DEFAULT 1,
                    token_version INTEGER NOT NULL DEFAULT 1
                )
                """
            )
            conn.commit()

            # Migration: add token_version if missing
            cursor.execute("PRAGMA table_info(users)")
            cols = [row["name"] for row in cursor.fetchall()]
            if "token_version" not in cols:
                cursor.execute("ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 1")
                conn.commit()

            # Seed default admin if no users exist
            cursor.execute("SELECT COUNT(*) FROM users")
            count = cursor.fetchone()[0]
            if count == 0:
                env_password = os.getenv("GB50_ADMIN_PASSWORD")
                if env_password:
                    admin_password = env_password
                elif os.getenv("GB50_INITIAL_ADMIN_PASSWORD"):
                    admin_password = os.getenv("GB50_INITIAL_ADMIN_PASSWORD")
                else:
                    admin_password = secrets.token_urlsafe(16)
                    _logger.warning("=" * 70)
                    _logger.warning("GENERATED INITIAL ADMIN BOOTSTRAP PASSWORD: %s", admin_password)
                    _logger.warning("Please save this password or set GB50_ADMIN_PASSWORD in environment.")
                    _logger.warning("=" * 70)

                now_str = datetime.now(timezone.utc).isoformat()
                cursor.execute(
                    """
                    INSERT INTO users (username, password_hash, role, display_name, created_at, enabled, token_version)
                    VALUES (?, ?, ?, ?, ?, 1, 1)
                    """,
                    (
                        "admin",
                        hash_password(admin_password),
                        "admin",
                        "Facility Administrator",
                        now_str,
                    ),
                )
                conn.commit()
                _logger.info("Initialized initial administrator account ('admin').")

    def get_user_by_username(self, username: str) -> Optional[Dict[str, Any]]:
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM users WHERE username = ? COLLATE NOCASE", (username,))
            row = cursor.fetchone()
            if row:
                return dict(row)
            return None

    def get_user_by_id(self, user_id: int) -> Optional[Dict[str, Any]]:
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,))
            row = cursor.fetchone()
            if row:
                return dict(row)
            return None

    def list_users(self) -> List[Dict[str, Any]]:
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT id, username, role, display_name, created_at, last_login, enabled FROM users ORDER BY id ASC")
            return [dict(row) for row in cursor.fetchall()]

    def create_user(self, username: str, password: str, role: str, display_name: str) -> Dict[str, Any]:
        with self._get_connection() as conn:
            cursor = conn.cursor()
            now_str = datetime.now(timezone.utc).isoformat()
            cursor.execute(
                """
                INSERT INTO users (username, password_hash, role, display_name, created_at, enabled)
                VALUES (?, ?, ?, ?, ?, 1)
                """,
                (username.strip(), hash_password(password), role, display_name.strip(), now_str),
            )
            conn.commit()
            user_id = cursor.lastrowid
            return self.get_user_by_id(user_id)

    def update_user(
        self,
        user_id: int,
        role: Optional[str] = None,
        display_name: Optional[str] = None,
        enabled: Optional[bool] = None,
        new_password: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        with self._get_connection() as conn:
            cursor = conn.cursor()
            updates = []
            params = []
            if role is not None:
                updates.append("role = ?")
                params.append(role)
            if display_name is not None:
                updates.append("display_name = ?")
                params.append(display_name.strip())
            if enabled is not None:
                updates.append("enabled = ?")
                params.append(1 if enabled else 0)
                if not enabled:
                    updates.append("token_version = token_version + 1")
            if new_password is not None and new_password.strip():
                updates.append("password_hash = ?")
                params.append(hash_password(new_password.strip()))
                updates.append("token_version = token_version + 1")

            if not updates:
                return self.get_user_by_id(user_id)

            params.append(user_id)
            cursor.execute(f"UPDATE users SET {', '.join(updates)} WHERE id = ?", params)
            conn.commit()
            return self.get_user_by_id(user_id)

    def update_last_login(self, user_id: int):
        with self._get_connection() as conn:
            cursor = conn.cursor()
            now_str = datetime.now(timezone.utc).isoformat()
            cursor.execute("UPDATE users SET last_login = ? WHERE id = ?", (now_str, user_id))
            conn.commit()

    def delete_user(self, user_id: int) -> bool:
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM users WHERE id = ?", (user_id,))
            conn.commit()
            return cursor.rowcount > 0


# Singleton User DB instance
user_db = UserDatabase()


# --- Pydantic Models for Auth ---

class LoginRequest(BaseModel):
    username: str
    password: str


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str


class CreateUserRequest(BaseModel):
    username: str
    password: str
    role: str = Field(..., pattern="^(admin|operator|viewer)$")
    display_name: str


class UpdateUserRequest(BaseModel):
    role: Optional[str] = Field(None, pattern="^(admin|operator|viewer)$")
    display_name: Optional[str] = None
    enabled: Optional[bool] = None
    new_password: Optional[str] = None


class UserProfileResponse(BaseModel):
    id: int
    username: str
    role: str
    display_name: str
    created_at: Optional[str] = None
    last_login: Optional[str] = None
    enabled: bool = True


# --- FastAPI Auth Dependencies ---

ROLE_HIERARCHY = {
    "viewer": 1,
    "operator": 2,
    "admin": 3,
}


async def get_current_user(
    request: Request,
    bearer: Optional[HTTPAuthorizationCredentials] = Depends(security_bearer),
) -> Dict[str, Any]:
    """Extract and validate authenticated user from Bearer header or Cookie."""
    token = None
    if bearer and bearer.credentials:
        token = bearer.credentials
    elif "gb50_token" in request.cookies:
        token = request.cookies["gb50_token"]

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated. Please log in.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    payload = decode_access_token(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session token invalid or expired. Please log in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user_id = int(payload["sub"])
    user = user_db.get_user_by_id(user_id)
    if not user or not user.get("enabled", 1):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User account is deactivated or no longer exists.",
        )

    token_ver = payload.get("token_ver")
    if token_ver is not None and token_ver != user.get("token_version", 1):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session has been revoked due to password change or security update. Please log in again.",
        )

    return user


def require_role(min_role: str):
    """Dependency that enforces a minimum user role ('viewer' <= 'operator' <= 'admin')."""
    min_level = ROLE_HIERARCHY.get(min_role, 1)

    async def _role_checker(user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
        user_role = user.get("role", "viewer")
        user_level = ROLE_HIERARCHY.get(user_role, 1)
        if user_level < min_level:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. Requires '{min_role}' role (current role: '{user_role}').",
            )
        return user
    return _role_checker


def get_or_create_kiosk_user(role: str = "viewer") -> Dict[str, Any]:
    """Retrieve existing kiosk user or create dedicated kiosk user account."""
    user = user_db.get_user_by_username("kiosk")
    if user:
        if not user.get("enabled", 1) or user.get("role") != role:
            user_db.update_user(user["id"], role=role, enabled=True)
            user = user_db.get_user_by_id(user["id"])
        return user
    pwd = secrets.token_urlsafe(32)
    created = user_db.create_user(
        username="kiosk",
        password=pwd,
        role=role,
        display_name="Kiosk Display",
    )
    return created


# --- Command-Line User & Password Management / Lockout Recovery ---

def _cli() -> None:
    import sys
    args = sys.argv[1:]
    if not args or args[0] in ("-h", "--help", "help"):
        print("\n=== GB-50 Gateway Credential & User Management CLI ===")
        print("Usage:")
        print("  python -m server.auth list")
        print("  python -m server.auth reset-password <username> <new_password>")
        print("  python -m server.auth add-user <username> <password> <role> \"<display_name>\"")
        print("  python -m server.auth generate-token <username> [hours]")
        print("  python -m server.auth reset-db\n")
        print("Roles: admin, operator, viewer")
        print(f"Database location: {DB_PATH}\n")
        return

    cmd = args[0].lower()
    if cmd == "list":
        users = user_db.list_users()
        print(f"\nDiscovered {len(users)} user account(s) in {DB_PATH}:")
        print(f"{'ID':<4} {'Username':<18} {'Role':<12} {'Status':<10} {'Display Name'}")
        print("-" * 65)
        for u in users:
            status_str = "ACTIVE" if u.get("enabled", 1) else "DISABLED"
            print(f"{u['id']:<4} {u['username']:<18} {u['role']:<12} {status_str:<10} {u['display_name']}")
        print()

    elif cmd == "reset-password":
        if len(args) < 3:
            print("Error: Missing arguments. Usage: python -m server.auth reset-password <username> <new_password>")
            sys.exit(1)
        username = args[1]
        new_pwd = args[2]
        user = user_db.get_user_by_username(username)
        if not user:
            print(f"Error: User '{username}' not found.")
            sys.exit(1)
        user_db.update_user(user["id"], new_password=new_pwd, enabled=True)
        print(f"✓ Successfully reset password for '{username}'. Account is now active.")

    elif cmd == "add-user":
        if len(args) < 5:
            print("Error: Missing arguments. Usage: python -m server.auth add-user <username> <password> <role> \"<display_name>\"")
            sys.exit(1)
        username = args[1]
        password = args[2]
        role = args[3].lower()
        display_name = args[4]
        if role not in ROLE_HIERARCHY:
            print(f"Error: Invalid role '{role}'. Choose from: admin, operator, viewer")
            sys.exit(1)
        existing = user_db.get_user_by_username(username)
        if existing:
            user_db.update_user(existing["id"], new_password=password, role=role, display_name=display_name, enabled=True)
            print(f"✓ Updated existing user '{username}' (Role: {role}).")
        else:
            user_db.create_user(username=username, password=password, role=role, display_name=display_name)
            print(f"✓ Created new user '{username}' (Role: {role}, Display: {display_name}).")

    elif cmd == "generate-token":
        if len(args) < 2:
            print("Error: Missing username. Usage: python -m server.auth generate-token <username> [hours]")
            sys.exit(1)
        username = args[1]
        hours = int(args[2]) if len(args) >= 3 and args[2].isdigit() else (24 * 365 * 5)
        user = user_db.get_user_by_username(username)
        if not user:
            print(f"Error: User '{username}' not found.")
            sys.exit(1)
        token = create_access_token(user, expires_in_hours=hours)
        print(f"\nGenerated JWT Access Token for '{username}' (Valid for {hours} hours):")
        print(token)
        print()

    elif cmd == "reset-db":
        if os.path.exists(DB_PATH):
            os.remove(DB_PATH)
            print(f"Removed database at {DB_PATH}.")
        user_db.init_db()
        print("✓ Initialized fresh database with accounts (configure credentials explicitly).")

    else:
        print(f"Unknown command: '{cmd}'. Run with --help for usage.")
        sys.exit(1)


if __name__ == "__main__":
    _cli()


"""Live read-only verification script against Mitsubishi GB-50 at the explicitly configured GB50_HOST."""

import sys
import os
import asyncio

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from gb50 import GB50Client


async def main():
    host = os.getenv("GB50_HOST", "").strip()
    if not host:
        raise SystemExit("Set GB50_HOST explicitly before running a live controller audit.")
    print(f"Connecting to live GB-50 controller at {host}...")
    async with GB50Client(host=host) as client:
        # 1. System Info
        info = await client.get_system_info()
        print(f"\n[System Info]")
        print(f"  Model: {info.model}")
        print(f"  Firmware Version: {info.version}")
        print(f"  System Name: {info.system_name}")
        print(f"  Serial Number: {info.serial_number}")
        print(f"  IP / MAC: {info.ip_address} / {info.mac_address}")
        print(f"  Licensed Features: {[k for k, v in info.licensed_functions.items() if v]}")

        # 2. Controller Clock & Summer Time
        dt = await client.get_datetime()
        print(f"\n[Controller Clock]")
        print(f"  Current Time: {dt.isoformat()}")

        st = await client.get_summertime()
        print(f"\n[Summer Time (DST)]")
        print(f"  Config: {st}")

        # 3. Night Setback
        sb = await client.get_setback()
        print(f"\n[Night Setback]")
        print(f"  Config: {sb}")

        # 4. Interlocks
        interlocks = await client.get_interlocks()
        print(f"\n[LOSSNAY Interlocks ({len(interlocks)} Total)]")
        print(f"  Pairings: {interlocks}")

        # 5. Topology & Groups
        groups = await client.get_all_groups(refresh_topology=True)
        print(f"\n[Discovered Groups ({len(groups)} Total)]")
        print(f"{'ID':<4} {'Name':<12} {'Model':<6} {'Drive':<6} {'Mode':<12} {'Set Temp':<10} {'Inlet Temp':<12} {'Filter':<8}")
        print("-" * 75)
        for g in groups[:5]:
            st_temp = f"{g.set_temp_f}°F ({g.set_temp_c}°C)" if g.set_temp_c is not None else "--"
            it_temp = f"{g.inlet_temp_f}°F ({g.inlet_temp_c}°C)" if g.inlet_temp_c is not None else "--"
            filter_str = "DIRTY" if g.filter_dirty else "OK"
            print(f"{g.group_id:<4} {g.name:<12} {g.model.value:<6} {g.drive.value:<6} {g.mode.value:<12} {st_temp:<10} {it_temp:<12} {filter_str:<8}")
        print(f"... and {len(groups) - 5} more groups.")


if __name__ == "__main__":
    asyncio.run(main())

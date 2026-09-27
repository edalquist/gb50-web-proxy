"""Comprehensive Read-Only Verification Script against Mitsubishi GB-50 at the explicitly configured GB50_HOST.

Strict Safety Constraint: This script strictly issues 'getRequest' packets.
NO 'setRequest' or mutating packets are generated or sent.
"""

import sys
import os
import asyncio
import json
from datetime import datetime

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PYTHON_GB50 = os.path.join(os.path.dirname(PROJECT_ROOT), "python-gb50")
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)
if PYTHON_GB50 not in sys.path:
    sys.path.insert(0, PYTHON_GB50)

from gb50 import GB50Client
from gb50.exceptions import GB50Error


async def main():
    host = os.getenv("GB50_HOST", "").strip()
    if not host:
        raise SystemExit("Set GB50_HOST explicitly before running a live controller audit.")
    print("=" * 80)
    print(f"MITSUBISHI GB-50 LIVE CONTROLLER READ-ONLY AUDIT ({host})")
    print(f"Timestamp: {datetime.now().isoformat()}")
    print("=" * 80)

    async with GB50Client(host=host, timeout=15.0) as client:
        # 1. System Info & Licenses
        print("\n[1. System Information & Licensed Capabilities]")
        try:
            sys_info = await client.get_system_info()
            print(f"  Model:            {sys_info.model}")
            print(f"  ROM Version:      {sys_info.version}")
            print(f"  System Name:      {sys_info.system_name}")
            print(f"  Serial Number:    {sys_info.serial_number}")
            print(f"  Location ID:      {sys_info.location_id}")
            print(f"  IP / Subnet / GW: {sys_info.ip_address} / {sys_info.subnet_mask} / {sys_info.gateway}")
            print(f"  MAC Address:      {sys_info.mac_address}")
            print(f"  Temp Unit / Time: {sys_info.temp_unit} / {sys_info.time_format}-Hour ({sys_info.date_format})")
            print(f"  M-Net Address:    {sys_info.mnet_address}")
            active_lic = [k for k, v in sys_info.licensed_functions.items() if v]
            print(f"  Active Licenses:  {', '.join(active_lic)}")
        except Exception as e:
            print(f"  ERROR: {e}")

        # 2. Controller Clock & Summer Time
        print("\n[2. Controller Clock & Summer Time (DST)]")
        try:
            dt = await client.get_datetime()
            print(f"  Controller Clock: {dt.isoformat()}")
            st = await client.get_summertime()
            print(f"  Summer Time DST:  {st}")
        except Exception as e:
            print(f"  ERROR: {e}")

        # 3. Night Setback Automation
        print("\n[3. Night Setback Settings]")
        try:
            sb = await client.get_setback()
            print(f"  Night Setback:    {sb}")
        except Exception as e:
            print(f"  ERROR: {e}")

        # 4. Topology Discovery (M-Net Groups, Unit Models, Slaves, Remote Controllers)
        print("\n[4. Topology Discovery & Device Allocations]")
        try:
            top = await client.get_topology(force_refresh=True)
            print(f"  Configured Groups: {len(top)}")
            print(f"  {'Group':<6} {'Name':<14} {'Model':<6} {'Primary IC':<11} {'Floor':<6} {'Slaves':<8} {'RCs':<6}")
            print("  " + "-" * 65)
            for gid in sorted(top.keys()):
                info = top[gid]
                slaves_str = str(info.get("slaves", [])) if info.get("slaves") else "-"
                rcs_str = str(info.get("rcs", [])) if info.get("rcs") else "-"
                print(f"  {gid:<6} {info.get('name', ''):<14} {str(info.get('model', '')):<6} {info.get('address', ''):<11} {str(info.get('floor', '')):<6} {slaves_str:<8} {rcs_str:<6}")
        except Exception as e:
            print(f"  ERROR: {e}")

        # 5. LOSSNAY Interlocks
        print("\n[5. LOSSNAY Ventilator Interlocks]")
        try:
            interlocks = await client.get_interlocks()
            print(f"  Total Interlocks: {len(interlocks)}")
            ic_to_lc = {i['ic_address']: i['lc_address'] for i in interlocks}
            print(f"  Sample Pairings:  {list(ic_to_lc.items())[:8]} ...")
        except Exception as e:
            print(f"  ERROR: {e}")

        # 6. Real-Time Mnet Telemetry & Binary Bulk Decodes
        print("\n[6. Live Group Telemetry (Bulk Telemetry Decoded)]")
        try:
            groups = await client.get_all_groups(refresh_topology=True)
            print(f"  Live Groups Polled: {len(groups)}")
            print(f"  {'ID':<4} {'Name':<14} {'Model':<5} {'Drive':<5} {'Mode':<10} {'Set Temp':<14} {'Inlet Temp':<14} {'Fan':<6} {'AirDir':<10} {'Filter':<7} {'Error':<6}")
            print("  " + "-" * 95)
            for g in groups:
                st_str = f"{g.set_temp_f}°F ({g.set_temp_c}°C)" if g.set_temp_c is not None else "--"
                it_str = f"{g.inlet_temp_f}°F ({g.inlet_temp_c}°C)" if g.inlet_temp_c is not None else "--"
                filter_str = "DIRTY" if g.filter_dirty else "OK"
                err_str = "FAULT" if g.error_active else "OK"
                print(f"  {g.group_id:<4} {g.name:<14} {g.model.value:<5} {g.drive.value:<5} {g.mode.value:<10} {st_str:<14} {it_str:<14} {g.fan_speed.value:<6} {g.air_direction.value:<10} {filter_str:<7} {err_str:<6}")
        except Exception as e:
            print(f"  ERROR: {e}")

        # 7. Today Schedule Query
        print("\n[7. Today Programmed Schedule Events]")
        try:
            all_schedules = await client.get_all_today_schedules()
            active_sched_count = sum(1 for items in all_schedules.values() if len(items) > 0)
            print(f"  Groups with Active Today Events: {active_sched_count} / {len(all_schedules)}")
            for gid, items in sorted(all_schedules.items()):
                if items:
                    events_str = ", ".join(f"[{item.time_str} {item.drive.value if item.drive else ''} {item.mode.value if item.mode else ''} {item.set_temp_f or ''}°F]" for item in items)
                    print(f"    Group {gid:<2}: {events_str}")
        except Exception as e:
            print(f"  ERROR: {e}")

        # 8. Weekly Schedule Query (Sample Group 1)
        print("\n[8. Weekly 7-Day Pattern (Sample: Group 1)]")
        try:
            weekly = await client.get_weekly_schedule(group_id=1, season=1)
            days = {1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat", 7: "Sun"}
            for day_idx, events in sorted(weekly.items()):
                day_name = days.get(day_idx, f"Day {day_idx}")
                ev_desc = ", ".join(f"{ev.time_str} ({ev.drive.value if ev.drive else ''} {ev.mode.value if ev.mode else ''} {ev.set_temp_f or ''}°F)" for ev in events) if events else "No events"
                print(f"    {day_name} (Pattern {day_idx}): {ev_desc}")
        except Exception as e:
            print(f"  ERROR: {e}")

        # 9. System Alarms & Fault History
        print("\n[9. Active Alarms & Diagnostic Fault History]")
        try:
            alarms = await client.get_alarms()
            print(f"  Total Alarm Records in Memory: {len(alarms)}")
            if alarms:
                for a in alarms[:10]:
                    status_lbl = "ACTIVE" if a.is_active else "RESOLVED"
                    print(f"    - [{status_lbl}] Code {a.error_code} on {a.unit_name} ({a.unit_model}): {a.title} (Occurred: {a.occurred_at}, Duration: {a.duration_str})")
            else:
                print("    No active or historical alarm records found (System Normal).")
        except Exception as e:
            print(f"  ERROR: {e}")

        # 10. Hardware account counts only; never request or display passwords.
        print("\n[10. Hardware User Account Counts]")
        try:
            for cat in ("Administrator", "Maintenance", "PublicUser"):
                users = await client.get_users(category=cat)
                print(f"  Category '{cat}': {len(users)} account(s)")
        except Exception as e:
            print(f"  ERROR: {e}")

    print("\n" + "=" * 80)
    print("LIVE AUDIT COMPLETED SUCCESSFULLY (100% READ-ONLY)")
    print("=" * 80)


if __name__ == "__main__":
    asyncio.run(main())

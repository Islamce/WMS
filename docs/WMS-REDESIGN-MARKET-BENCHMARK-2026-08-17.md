# KYNOX WMS Experience Redesign — Market Pattern Benchmark

**Date:** 2026-08-17  
**Scope:** Interaction and process architecture only; vendor claims are not treated as product requirements.

## Evidence-led patterns

| Market source | Observed pattern | KYNOX implication | Classification |
|---|---|---|---|
| SAP EWM / Fiori reference material | Warehouse work is organized around work centers, warehouse context, and operational KPI views rather than one undifferentiated page. | Keep warehouse/role context visible and make KPI signals drill into operational work. | MARKET PATTERN |
| Oracle WMS task-management documentation | Tasks from inbound, outbound, replenishment, transfers, and cycle counts can be placed into a common pool, filtered, prioritized, dispatched, assigned, and monitored through a warehouse control board. | Build reusable queue primitives with process, owner, priority, age, status, and exception filters; preserve KYNOX’s narrower implemented scope. | MARKET PATTERN |
| Manhattan Active Warehouse | The product emphasizes a unified operational data model, real-time facility visibility, workload/resource prioritization, actionable insights, and execution across warehouse functions. | Make Command Center → queue → object → action the primary navigation loop and avoid isolated decorative dashboards. | MARKET PATTERN |
| Blue Yonder Warehouse Management | The product groups warehouse operations, resource orchestration, execution, labor, slotting, and actionable recommendations around a real-time operational platform. | Surface operational attention and workload before analytics; do not expose unsupported AI/resource orchestration as active KYNOX functionality. | MARKET PATTERN / SCOPE GUARD |
| Dynamics 365 Warehouse Management mobile app | The mobile product is worker-authenticated, supports device configuration including QR-based setup, and loads worker-specific preferences such as default warehouse. | Keep Flutter role/warehouse context explicit, support fast scanning and worker-specific task entry, and preserve secure device/session behavior. | MARKET PATTERN |
| Odoo Inventory | The simpler model distinguishes warehouses, internal locations, virtual locations, inventory adjustments, and cycle counts with clear location semantics. | Use clear warehouse/location/bin hierarchy and avoid hiding inventory provenance behind generic stock labels. | MARKET PATTERN |

## KYNOX design decisions derived from the benchmark

The benchmark supports a **control-tower plus work-queue** model: the Command Center should identify operational signals, each signal should open a filtered queue, and queue rows should open a contextual object with one valid next action. This is consistent with the attached operating model while remaining implementable over the existing KYNOX APIs.

The benchmark also supports a **shared operational context** model. Warehouse, role, owner, priority, age, and status should be visible at the point of work. The redesign should therefore strengthen context bars, object headers, workflow timelines, exception banners, and queue filters rather than multiplying page-level dashboards.

Mobile should remain an **execution surface**, not a compressed desktop information architecture. The Flutter experience should prioritize assigned work, scan entry, guided validation, quantity confirmation, shortage handling, and actionable alerts; administrative and analytical breadth should remain role-gated and secondary.

No vendor pattern justifies inventing functionality absent from the repository. In particular, KYNOX should not claim wave planning, robotics orchestration, predictive AI, slotting automation, or direct ERP integration unless those capabilities are separately implemented and evidenced.

## References

1. [SAP Help — Work Center](https://help.sap.com/docs/SAP_EXTENDED_WAREHOUSE_MANAGEMENT/3d97bec9bf1649099384bb8167df3cf2/d1cccb53ad377114e10000000a174cb4.html)
2. [SAP Fiori Apps Reference Library — Warehouse KPIs](https://fioriappslibrary.hana.ondemand.com/sap/fix/externalViewer/#/detail/Apps('F4024')/S18OP)
3. [Oracle WMS User’s Guide — Task Management](https://docs.oracle.com/cd/E26401_01/doc.122/e48830/T211976T430466.htm)
4. [Manhattan Active Warehouse Management](https://www.manh.com/solutions/supply-chain-management-software/warehouse-management)
5. [Blue Yonder — Warehouse Management](https://blueyonder.com/solutions/warehouse-management)
6. [Microsoft Dynamics 365 — Install the Warehouse Management mobile app](https://learn.microsoft.com/en-us/dynamics365/supply-chain/warehousing/install-configure-warehouse-management-app)
7. [Odoo 19 — Inventory management](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/inventory/warehouses_storage/inventory_management.html)

**Author:** Manus AI

> Vendor material is used as comparative evidence for interaction patterns. It does not override KYNOX repository truth, permissions, workflow semantics, or scope controls.


/**
 * Vendor vocabulary. Values match the Prisma `WarrantyStatus` / `DispatchStatus`
 * enums and the free-form `Vendor.type` column (build spec §13, §10.13).
 */
export type VendorType = "DELL" | "HPE" | "ISP" | "LOCAL";
export const VENDOR_TYPES: readonly VendorType[] = ["DELL", "HPE", "ISP", "LOCAL"];

export type WarrantyStatus = "ACTIVE" | "EXPIRED" | "UNKNOWN";
export const WARRANTY_STATUSES: readonly WarrantyStatus[] = ["ACTIVE", "EXPIRED", "UNKNOWN"];

export type DispatchStatus =
  "REQUESTED" | "APPROVED" | "SHIPPED" | "DELIVERED" | "INSTALLED" | "RETURNED";
export const DISPATCH_STATUSES: readonly DispatchStatus[] = [
  "REQUESTED",
  "APPROVED",
  "SHIPPED",
  "DELIVERED",
  "INSTALLED",
  "RETURNED",
];

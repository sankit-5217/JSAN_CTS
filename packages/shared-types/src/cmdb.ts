export enum CiType {
  SERVER = "SERVER",
  FIREWALL = "FIREWALL",
  SWITCH = "SWITCH",
  UPS = "UPS",
  PDU = "PDU",
  STORAGE = "STORAGE",
  SERVICE = "SERVICE",
  CIRCUIT = "CIRCUIT",
  VM = "VM",
}

export enum ManagedBy {
  JSAN = "JSAN",
  CTS = "CTS",
  SHARED = "SHARED",
  VENDOR = "VENDOR",
}

export enum Criticality {
  CRITICAL = "CRITICAL",
  HIGH = "HIGH",
  MEDIUM = "MEDIUM",
  LOW = "LOW",
}

export enum HealthStatus {
  HEALTHY = "HEALTHY",
  WARNING = "WARNING",
  CRITICAL = "CRITICAL",
  UNKNOWN = "UNKNOWN",
  MAINTENANCE = "MAINTENANCE",
}

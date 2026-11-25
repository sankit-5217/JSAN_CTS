import "reflect-metadata";
import { GUARDS_METADATA, METHOD_METADATA } from "@nestjs/common/constants";
import { UserRole } from "@prisma/client";
import { ROLES_KEY } from "../../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../../auth/guards/roles.guard";
import {
  ZABBIX_ACK_ROLES,
  ZABBIX_ADMIN_ROLES,
  ZABBIX_VIEW_ROLES,
  ZabbixController,
} from "./zabbix.controller";

/**
 * Authorization contract for the Zabbix routes. Unlike the other Dev B
 * controllers (see authz-contract.spec.ts) reads here are role-gated too, so
 * this locks the role set on every route instead.
 */
const proto = ZabbixController.prototype as unknown as Record<string, () => unknown>;
const rolesOf = (name: string) =>
  Reflect.getMetadata(ROLES_KEY, proto[name]) as UserRole[] | undefined;

describe("ZabbixController authorization", () => {
  it("sits behind JwtAuthGuard and RolesGuard", () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, ZabbixController) as unknown[];
    expect(guards).toEqual(expect.arrayContaining([JwtAuthGuard, RolesGuard]));
  });

  it("declares roles on every route", () => {
    const routes = Object.getOwnPropertyNames(proto).filter(
      (n) => n !== "constructor" && Reflect.getMetadata(METHOD_METADATA, proto[n]) !== undefined,
    );
    expect(routes.length).toBeGreaterThanOrEqual(9);
    for (const r of routes) expect(rolesOf(r)?.length).toBeGreaterThan(0);
  });

  it("keeps settings admin-only", () => {
    for (const r of ["getSettings", "updateSettings", "testConnection"]) {
      expect(rolesOf(r)).toEqual([...ZABBIX_ADMIN_ROLES]);
    }
  });

  it("never shows raw monitoring to client viewers", () => {
    for (const r of ["listHosts", "getHost", "listItems", "getHistory", "listProblems"]) {
      expect(rolesOf(r)).toEqual([...ZABBIX_VIEW_ROLES]);
    }
    expect(ZABBIX_VIEW_ROLES).not.toContain(UserRole.CLIENT_MANAGER_VIEWER);
  });

  it("limits acknowledge to operational roles", () => {
    expect(rolesOf("acknowledge")).toEqual([...ZABBIX_ACK_ROLES]);
    expect(ZABBIX_ACK_ROLES).not.toContain(UserRole.AUDITOR_READ_ONLY);
    expect(ZABBIX_ACK_ROLES).not.toContain(UserRole.CLIENT_MANAGER_VIEWER);
  });
});

import "reflect-metadata";
import { RequestMethod } from "@nestjs/common";
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { UserRole } from "@prisma/client";
import { ROLES_KEY } from "./auth/decorators/roles.decorator";
import { JwtAuthGuard } from "./auth/guards/jwt-auth.guard";
import { RolesGuard } from "./auth/guards/roles.guard";

import { AlertRulesController } from "./alerts/alert-rules.controller";
import { AlertsController } from "./alerts/alerts.controller";
import { ChangesController } from "./changes/changes.controller";
import { KnowledgeController } from "./knowledge/knowledge.controller";
import { MonitoringController } from "./monitoring/monitoring.controller";
import { ProblemsController } from "./problems/problems.controller";
import { BcpController } from "./risks/bcp.controller";
import { RisksController } from "./risks/risks.controller";
import { VendorCasesController } from "./vendors/vendor-cases.controller";
import { VendorsController } from "./vendors/vendors.controller";
import { WarrantyController } from "./vendors/warranty.controller";

/**
 * Authorization contract for every Dev B controller (spec §4, §12; Definition
 * of Done: "backend authorization ... demonstrated"). The service logic is
 * unit-tested per module; this locks the wiring that actually gates access:
 *
 *  - the controller sits behind JwtAuthGuard *and* RolesGuard;
 *  - every state-changing route (POST/PUT/PATCH/DELETE) declares @Roles with a
 *    non-empty set of real UserRole values;
 *  - read routes (GET) carry no @Roles — any authenticated user may read.
 *
 * A new mutation added without @Roles, a dropped guard, or a typo'd role name
 * fails here instead of shipping an open endpoint.
 */

const DEV_B_CONTROLLERS = [
  AlertsController,
  AlertRulesController,
  ChangesController,
  KnowledgeController,
  MonitoringController,
  ProblemsController,
  RisksController,
  BcpController,
  VendorsController,
  VendorCasesController,
  WarrantyController,
];

const WRITE_METHODS = new Set([
  RequestMethod.POST,
  RequestMethod.PUT,
  RequestMethod.PATCH,
  RequestMethod.DELETE,
]);

const VALID_ROLES = new Set<string>(Object.values(UserRole));

interface Handler {
  name: string;
  fn: (...args: unknown[]) => unknown;
  httpMethod: RequestMethod;
  path: string;
}

function routeHandlers(controller: new (...args: never[]) => object): Handler[] {
  const proto = controller.prototype as Record<string, (...a: unknown[]) => unknown>;
  return Object.getOwnPropertyNames(proto)
    .filter((name) => name !== "constructor" && typeof proto[name] === "function")
    .map((name) => ({
      name,
      fn: proto[name],
      httpMethod: Reflect.getMetadata(METHOD_METADATA, proto[name]) as RequestMethod,
      path: Reflect.getMetadata(PATH_METADATA, proto[name]) as string,
    }))
    .filter((h) => h.httpMethod !== undefined);
}

describe("Dev B authorization contract", () => {
  describe.each(DEV_B_CONTROLLERS.map((c) => [c.name, c] as const))("%s", (_name, controller) => {
    const guards = (Reflect.getMetadata(GUARDS_METADATA, controller) ?? []) as unknown[];

    it("is guarded by JwtAuthGuard then RolesGuard at the class level", () => {
      expect(guards).toContain(JwtAuthGuard);
      expect(guards).toContain(RolesGuard);
      // JWT must resolve the principal before RolesGuard inspects its role.
      expect(guards.indexOf(JwtAuthGuard)).toBeLessThan(guards.indexOf(RolesGuard));
    });

    const handlers = routeHandlers(controller);

    it("exposes at least one route", () => {
      expect(handlers.length).toBeGreaterThan(0);
    });

    it.each(
      handlers.map((h) => [`${h.name} (${RequestMethod[h.httpMethod]} /${h.path})`, h] as const),
    )("%s has the right @Roles", (_label, h: Handler) => {
      const roles = Reflect.getMetadata(ROLES_KEY, h.fn) as UserRole[] | undefined;
      if (WRITE_METHODS.has(h.httpMethod)) {
        expect(Array.isArray(roles)).toBe(true);
        expect(roles && roles.length).toBeGreaterThan(0);
        for (const r of roles ?? []) {
          expect(VALID_ROLES.has(r)).toBe(true);
        }
      } else {
        // read route — open to any authenticated user
        expect(roles).toBeUndefined();
      }
    });
  });
});

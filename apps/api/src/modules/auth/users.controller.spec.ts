import { ForbiddenException } from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { AuthzService } from "./authz.service";
import { ListUsersQueryDto } from "./dto/list-users-query.dto";
import { AuthenticatedUser } from "./types/jwt-payload.type";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";

describe("UsersController", () => {
  const caller: AuthenticatedUser = {
    id: "caller-1",
    email: "servicedesk@example.com",
    role: UserRole.SERVICE_DESK_NOC,
    isActive: true,
  };

  function makeController(canAccessSite = true, rows: unknown[] = []) {
    const usersService = { findAll: jest.fn().mockResolvedValue(rows) } as unknown as UsersService;
    const authzService = {
      canAccessSite: jest.fn().mockResolvedValue(canAccessSite),
    } as unknown as AuthzService;
    return {
      controller: new UsersController(usersService, authzService),
      usersService,
      authzService,
    };
  }

  it("passes the query straight through when no siteId is given", async () => {
    const { controller, usersService, authzService } = makeController();
    const query: ListUsersQueryDto = { role: UserRole.SITE_ENGINEER } as ListUsersQueryDto;
    await controller.findAll(query, caller);
    expect(authzService.canAccessSite).not.toHaveBeenCalled();
    expect(usersService.findAll).toHaveBeenCalledWith(query);
  });

  it("checks site access and lists when the caller can access the site", async () => {
    const rows = [
      { id: "u1", displayName: "Eng One", email: "eng1@example.com", role: "SITE_ENGINEER" },
    ];
    const { controller, authzService } = makeController(true, rows);
    const query: ListUsersQueryDto = { siteId: "site-1" } as ListUsersQueryDto;
    await expect(controller.findAll(query, caller)).resolves.toEqual(rows);
    expect(authzService.canAccessSite).toHaveBeenCalledWith(caller, "site-1");
  });

  it("rejects with ForbiddenException when the caller can't access the requested site", async () => {
    const { controller, usersService } = makeController(false);
    const query: ListUsersQueryDto = { siteId: "site-9" } as ListUsersQueryDto;
    await expect(controller.findAll(query, caller)).rejects.toBeInstanceOf(ForbiddenException);
    expect(usersService.findAll).not.toHaveBeenCalled();
  });
});

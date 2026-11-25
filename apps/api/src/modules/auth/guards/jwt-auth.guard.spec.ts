import { Controller, ExecutionContext, ForbiddenException, Get } from "@nestjs/common";
import { AllowWhilePasswordChangeRequired } from "../decorators/allow-while-password-change-required.decorator";
import { JwtAuthGuard, PASSWORD_CHANGE_REQUIRED } from "./jwt-auth.guard";

@Controller()
class Routes {
  @Get() normal() {}
  @Get() @AllowWhilePasswordChangeRequired() change() {}
}

function contextFor(handler: () => void, user: Record<string, unknown>): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => Routes,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe("JwtAuthGuard: admin-set password must be changed first", () => {
  const guard = new JwtAuthGuard();
  // Authentication itself (passport) is covered by the e2e tests.
  beforeEach(() => {
    jest
      .spyOn(Object.getPrototypeOf(JwtAuthGuard.prototype), "canActivate")
      .mockResolvedValue(true as never);
  });
  afterEach(() => jest.restoreAllMocks());

  it("lets a normal user through", async () => {
    await expect(guard.canActivate(contextFor(Routes.prototype.normal, { id: "u" }))).resolves.toBe(
      true,
    );
  });

  it("refuses every other route with PASSWORD_CHANGE_REQUIRED while the change is pending", async () => {
    const err = await guard
      .canActivate(contextFor(Routes.prototype.normal, { id: "u", mustChangePassword: true }))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect((err as ForbiddenException).getResponse()).toMatchObject({
      code: PASSWORD_CHANGE_REQUIRED,
    });
  });

  it("allows the routes marked for it (changing the password)", async () => {
    await expect(
      guard.canActivate(contextFor(Routes.prototype.change, { id: "u", mustChangePassword: true })),
    ).resolves.toBe(true);
  });
});

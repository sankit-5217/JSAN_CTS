import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../common/prisma/prisma.service";
import { CreateVendorCaseDto } from "./dto/create-vendor-case.dto";
import { VendorsService } from "./vendors.service";

type PrismaMock = {
  vendor: { create: jest.Mock; findMany: jest.Mock; findUnique: jest.Mock };
  vendorCase: {
    create: jest.Mock;
    findMany: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
  };
  vendorCaseUpdate: { create: jest.Mock };
  incident: { findUnique: jest.Mock };
  configurationItem: { findUnique: jest.Mock };
};

function createPrismaMock(): PrismaMock {
  return {
    vendor: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() },
    vendorCase: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    vendorCaseUpdate: { create: jest.fn() },
    incident: { findUnique: jest.fn() },
    configurationItem: { findUnique: jest.fn() },
  };
}

const VENDOR_ID = "11111111-1111-1111-1111-111111111111";

function caseDto(overrides: Partial<CreateVendorCaseDto> = {}): CreateVendorCaseDto {
  return { vendorCaseNo: "SR100", vendorId: VENDOR_ID, ...overrides };
}

describe("VendorsService", () => {
  let prisma: PrismaMock;
  let service: VendorsService;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new VendorsService(prisma as unknown as PrismaService);
    prisma.vendor.findUnique.mockResolvedValue({ id: VENDOR_ID, name: "Dell", type: "DELL" });
  });

  it("creates a vendor", async () => {
    prisma.vendor.create.mockResolvedValue({ id: VENDOR_ID });
    await service.createVendor({ name: "Dell ProSupport", type: "DELL" });
    expect(prisma.vendor.create).toHaveBeenCalledWith({
      data: { name: "Dell ProSupport", type: "DELL" },
    });
  });

  it("throws NotFoundException for an unknown vendor", async () => {
    prisma.vendor.findUnique.mockResolvedValue(null);
    await expect(service.getVendor("missing")).rejects.toBeInstanceOf(NotFoundException);
  });

  describe("openCase", () => {
    it("opens a case with defaults when the vendor exists", async () => {
      prisma.vendorCase.create.mockResolvedValue({ id: "case-1" });
      await service.openCase(caseDto());
      expect(prisma.vendorCase.create).toHaveBeenCalledWith({
        data: {
          vendorCaseNo: "SR100",
          vendorId: VENDOR_ID,
          linkedIncidentId: null,
          ciId: null,
          warrantyStatus: "UNKNOWN",
          rmaRequired: false,
          replacementPart: null,
        },
      });
    });

    it("rejects an unknown vendor", async () => {
      prisma.vendor.findUnique.mockResolvedValue(null);
      await expect(service.openCase(caseDto())).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.vendorCase.create).not.toHaveBeenCalled();
    });

    it("rejects a linkedIncidentId that does not exist", async () => {
      prisma.incident.findUnique.mockResolvedValue(null);
      await expect(
        service.openCase(caseDto({ linkedIncidentId: "22222222-2222-2222-2222-222222222222" })),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("updateCase", () => {
    function mockCase(overrides: Record<string, unknown> = {}) {
      prisma.vendorCase.findUnique.mockResolvedValue({
        id: "case-1",
        dispatchStatus: null,
        rmaRequired: false,
        acknowledgedAt: null,
        closedAt: null,
        updates: [],
        ...overrides,
      });
    }

    it("applies a valid dispatch transition and implies rmaRequired", async () => {
      mockCase();
      prisma.vendorCase.update.mockResolvedValue({ id: "case-1" });

      await service.updateCase("case-1", { dispatchStatus: "REQUESTED" });

      expect(prisma.vendorCase.update).toHaveBeenCalledWith({
        where: { id: "case-1" },
        data: { dispatchStatus: "REQUESTED", rmaRequired: true },
      });
    });

    it("rejects an invalid dispatch transition", async () => {
      mockCase({ dispatchStatus: "REQUESTED", rmaRequired: true });
      await expect(
        service.updateCase("case-1", { dispatchStatus: "SHIPPED" }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.vendorCase.update).not.toHaveBeenCalled();
    });

    it("refuses to update a closed case", async () => {
      mockCase({ closedAt: new Date() });
      await expect(
        service.updateCase("case-1", { warrantyStatus: "ACTIVE" }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it("closes the case with an outcome", async () => {
      mockCase({ dispatchStatus: "INSTALLED", rmaRequired: true });
      prisma.vendorCase.update.mockResolvedValue({ id: "case-1" });

      await service.updateCase("case-1", { closeOutcome: "Replaced PSU, system healthy" });

      const data = prisma.vendorCase.update.mock.calls[0][0].data;
      expect(data.outcome).toBe("Replaced PSU, system healthy");
      expect(data.closedAt).toBeInstanceOf(Date);
    });

    it("does not re-stamp acknowledgedAt when already acknowledged", async () => {
      mockCase({ acknowledgedAt: new Date("2026-09-01T00:00:00.000Z") });
      prisma.vendorCase.update.mockResolvedValue({ id: "case-1" });

      await service.updateCase("case-1", { acknowledged: true });

      expect(prisma.vendorCase.update.mock.calls[0][0].data).not.toHaveProperty("acknowledgedAt");
    });
  });

  describe("addUpdate", () => {
    it("appends a note to an existing case", async () => {
      prisma.vendorCase.findUnique.mockResolvedValue({ id: "case-1", updates: [] });
      prisma.vendorCaseUpdate.create.mockResolvedValue({ id: "u1" });

      await service.addUpdate("case-1", { note: "Vendor acknowledged" });

      expect(prisma.vendorCaseUpdate.create).toHaveBeenCalledWith({
        data: { vendorCaseId: "case-1", note: "Vendor acknowledged" },
      });
    });

    it("rejects a note on an unknown case", async () => {
      prisma.vendorCase.findUnique.mockResolvedValue(null);
      await expect(service.addUpdate("missing", { note: "x" })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});

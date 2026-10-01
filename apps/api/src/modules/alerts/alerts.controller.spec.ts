import { ExecutionContext, INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Server } from "node:http";
import request from "supertest";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { AlertsController } from "./alerts.controller";
import { AlertsService } from "./alerts.service";
import { AlertmanagerAlertDto, AlertmanagerWebhookDto } from "./dto/alertmanager-webhook.dto";
import { SnmpTrapDto } from "./dto/snmp-trap.dto";
import { ZabbixWebhookEventDto } from "./dto/zabbix-webhook.dto";

/**
 * The monitoring-source routes over a real HTTP pipeline with the same global
 * ValidationPipe as `main.ts`. A real Alertmanager/Zabbix delivery carries
 * fields OpsDesk does not model; those must be stripped, not rejected — while
 * the strict `ingest` contract keeps rejecting unknown fields.
 */
describe("AlertsController (source payload validation)", () => {
  let app: INestApplication;
  const service = {
    ingest: jest.fn().mockResolvedValue({}),
    ingestFromZabbix: jest.fn().mockResolvedValue({}),
    ingestFromAlertmanager: jest.fn().mockResolvedValue({}),
    ingestFromSnmp: jest.fn().mockResolvedValue({}),
  };
  const http = () => request(app.getHttpServer() as Server);

  beforeAll(async () => {
    const allowAs = {
      canActivate: (ctx: ExecutionContext) => {
        ctx.switchToHttp().getRequest().user = { id: "user-1" };
        return true;
      },
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [AlertsController],
      providers: [{ provide: AlertsService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(allowAs)
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });

  afterAll(() => app.close());
  beforeEach(() => jest.clearAllMocks());

  const alert = {
    status: "firing",
    labels: { alertname: "HostExporterDown", site: "SITE01", ci: "SITE01-R01-SRV-001" },
    annotations: { summary: "down" },
    startsAt: "2026-10-01T10:00:00.000Z",
    endsAt: "0001-01-01T00:00:00Z",
    fingerprint: "abc123",
  };

  it("Alertmanager: accepts a delivery with fields OpsDesk does not model, and strips them", async () => {
    await http()
      .post("/alerts/sources/alertmanager")
      .send({
        version: "4",
        status: "firing",
        receiver: "opsdesk",
        alerts: [{ ...alert, someFutureAlertField: true }],
        // sent by Alertmanager 0.34, absent from the DTO
        notification_reason: "new_alert",
        routeLabels: { team: "noc" },
      })
      .expect(200);

    const [body] = service.ingestFromAlertmanager.mock.calls[0];
    expect(body).toBeInstanceOf(AlertmanagerWebhookDto);
    expect(body).not.toHaveProperty("notification_reason");
    expect(body).not.toHaveProperty("routeLabels");
    expect(body.alerts[0]).toBeInstanceOf(AlertmanagerAlertDto);
    expect(body.alerts[0]).not.toHaveProperty("someFutureAlertField");
    expect(body.alerts[0].labels).toEqual(alert.labels);
  });

  it("Alertmanager: still validates the fields it does model (400)", async () => {
    await http()
      .post("/alerts/sources/alertmanager")
      .send({ version: "4", status: "firing", alerts: [] })
      .expect(400);
    await http()
      .post("/alerts/sources/alertmanager")
      .send({ version: "4", status: "firing", alerts: [{ ...alert, status: "pending" }] })
      .expect(400);
    expect(service.ingestFromAlertmanager).not.toHaveBeenCalled();
  });

  it("Zabbix: strips an unmodelled media-type field instead of rejecting the batch", async () => {
    await http()
      .post("/alerts/sources/zabbix")
      .send({
        events: [
          {
            eventId: "1",
            eventValue: "1",
            name: "PSU failed",
            timestamp: "1756808100",
            host: "SITE01-R01-SRV-001",
            customMacro: "x",
          },
        ],
      })
      .expect(200);

    const [events] = service.ingestFromZabbix.mock.calls[0];
    expect(events[0]).toBeInstanceOf(ZabbixWebhookEventDto);
    expect(events[0]).not.toHaveProperty("customMacro");
  });

  it("SNMP: strips an unmodelled trap field instead of rejecting the batch", async () => {
    await http()
      .post("/alerts/sources/snmp")
      .send({ traps: [{ ciCode: "SITE01-R01-SW-001", agentAddress: "10.0.0.1", extra: 1 }] })
      .expect(200);

    const [traps] = service.ingestFromSnmp.mock.calls[0];
    expect(traps[0]).toBeInstanceOf(SnmpTrapDto);
    expect(traps[0]).not.toHaveProperty("extra");
  });

  it("ingest: keeps rejecting unknown fields on the normalized contract (400)", async () => {
    await http().post("/alerts/ingest").send({ bogusField: 1 }).expect(400);
    expect(service.ingest).not.toHaveBeenCalled();
  });
});

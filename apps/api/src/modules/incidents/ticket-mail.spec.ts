import { IncidentStatus, UserRole } from "@prisma/client";
import { ticketEntityRef, ticketRecipients, TicketMailIncident } from "./ticket-mail";

const users: Record<
  string,
  { id: string; email: string; displayName: string; isActive: boolean; role: UserRole }
> = {
  eng: {
    id: "eng",
    email: "eng@jsan.example",
    displayName: "Rahul",
    isActive: true,
    role: UserRole.SITE_ENGINEER,
  },
  client: {
    id: "client",
    email: "Jane@Client.example",
    displayName: "Jane",
    isActive: true,
    role: UserRole.CLIENT_MANAGER_VIEWER,
  },
};

function db(
  groupMembers: { email: string; displayName: string }[] = [],
  desk: (typeof users.eng)[] = [],
) {
  return {
    user: {
      findUnique: jest.fn(({ where }) => Promise.resolve(users[where.id] ?? null)),
      findMany: jest.fn().mockResolvedValue(desk),
    },
    supportGroup: { findUnique: jest.fn().mockResolvedValue({ name: "Infra team" }) },
    supportGroupMember: {
      findMany: jest.fn().mockResolvedValue(groupMembers.map((user) => ({ user }))),
    },
    issueCatalogOption: { findUnique: jest.fn().mockResolvedValue({ label: "Bug" }) },
  } as never;
}

function incident(overrides: Partial<TicketMailIncident> = {}): TicketMailIncident {
  return {
    incidentNo: "INC-00002",
    shortDescription: "Uploads are slow",
    priority: "P3",
    severity: "S3",
    issueType: "BUG",
    status: IncidentStatus.IN_PROGRESS,
    ownerUserId: "eng",
    ownerGroupId: "grp",
    reportedByUserId: "client",
    ccEmails: ["ops@client.example", "jane@client.example"],
    ...overrides,
  };
}

describe("ticketRecipients", () => {
  const group = [
    { email: "eng@jsan.example", displayName: "Rahul" },
    { email: "amit@jsan.example", displayName: "Amit" },
  ];

  it("puts only the assignee on To, never the rest of the group; reporter and CC list on Cc, each once", async () => {
    const r = await ticketRecipients(db(group), incident());
    expect(r).toEqual({
      to: [{ name: "Rahul", email: "eng@jsan.example" }],
      // jane@client.example on the CC list is the reporter: listed once.
      cc: [{ name: "Jane", email: "Jane@Client.example" }, { email: "ops@client.example" }],
    });
  });

  it("writes to the whole group while nobody is assigned", async () => {
    const r = await ticketRecipients(db(group), incident({ ownerUserId: null }));
    expect(r?.to).toEqual([
      { name: "Rahul", email: "eng@jsan.example" },
      { name: "Amit", email: "amit@jsan.example" },
    ]);
  });

  it("keeps the reporter and CC list off an internal mail", async () => {
    const r = await ticketRecipients(db(), incident({ ownerGroupId: null }), { internal: true });
    expect(r).toEqual({ to: [{ name: "Rahul", email: "eng@jsan.example" }] });
  });

  it("falls back to the service desk when nobody is assigned", async () => {
    const desk = [{ ...users.eng, id: "desk", email: "desk@jsan.example", displayName: "Desk" }];
    const r = await ticketRecipients(
      db([], desk),
      incident({ ownerUserId: null, ownerGroupId: null }),
    );
    expect(r?.to).toEqual([{ name: "Desk", email: "desk@jsan.example" }]);
  });

  it("writes to the Cc people directly when there is no staff at all, and to no one when empty", async () => {
    const bare = incident({ ownerUserId: null, ownerGroupId: null });
    expect((await ticketRecipients(db(), bare))?.to).toHaveLength(2);
    expect(await ticketRecipients(db(), bare, { internal: true })).toBeNull();
  });
});

describe("ticketEntityRef", () => {
  it("shows labels, names and who did it", async () => {
    const ref = await ticketEntityRef(db(), incident(), {
      userId: "client",
      at: new Date("2026-10-22T11:10:00Z"),
    });
    expect(ref).toEqual({
      key: "INC-00002",
      title: "Uploads are slow",
      priority: "P3",
      severity: "S3",
      ticket: {
        issueType: "Bug",
        status: "In Progress",
        assignee: "Rahul",
        assigneeGroup: "Infra team",
        updatedBy: { name: "Jane", role: "Client", at: "2026-10-22T11:10:00.000Z" },
      },
    });
  });

  it("names a system actor and leaves a missing severity out", async () => {
    const ref = await ticketEntityRef(db(), incident({ severity: null }), {
      name: "Skill-based routing",
    });
    expect(ref.severity).toBeUndefined();
    expect(ref.ticket?.updatedBy).toMatchObject({ name: "Skill-based routing", role: undefined });
  });
});

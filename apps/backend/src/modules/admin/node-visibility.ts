import {
  ARCHITECT_NODE_CATALOG,
  ARCHITECT_NODE_GROUP_ORDER,
  hiddenArchitectNodeTypes,
  isArchitectNodeType,
  resolveArchitectNodeVisibility,
  type ArchitectNodeOverride
} from "@coreai/shared";
import { prisma } from "../../lib/prisma";

export type ArchitectNodeVisibilityView = {
  type: string;
  group: string;
  label: string;
  visible: boolean;
  defaultVisible: boolean;
  defaultLabel: string;
  defaultGroup: string;
};

export type ArchitectNodeVisibilityUpdate = {
  type: string;
  visible?: boolean;
  label?: string;
  group?: string;
};

let cache: Map<string, ArchitectNodeOverride> | null = null;

export function invalidateArchitectNodeVisibilityCache(): void {
  cache = null;
}

function trimOverride(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function loadOverrides(): Promise<Map<string, ArchitectNodeOverride>> {
  if (cache) return cache;
  const rows = await prisma.architectNodeVisibility.findMany({
    select: { nodeType: true, visible: true, label: true, group: true }
  });
  cache = new Map(
    rows.map((row) => [
      row.nodeType,
      {
        visible: row.visible,
        label: row.label,
        group: row.group
      }
    ])
  );
  return cache;
}

export async function listArchitectNodeVisibility(): Promise<ArchitectNodeVisibilityView[]> {
  const overrides = await loadOverrides();
  return resolveArchitectNodeVisibility(overrides).map((item) => ({
    type: item.type,
    group: item.group,
    label: item.label,
    visible: item.visible,
    defaultVisible: item.defaultVisible,
    defaultLabel: item.defaultLabel,
    defaultGroup: item.defaultGroup
  }));
}

export async function listHiddenArchitectNodeTypes(): Promise<string[]> {
  const overrides = await loadOverrides();
  return hiddenArchitectNodeTypes(overrides);
}

export async function saveArchitectNodeVisibility(
  updates: ArchitectNodeVisibilityUpdate[]
): Promise<{ saved: number }> {
  const allowed = updates.filter((item) => isArchitectNodeType(item.type));
  if (allowed.length === 0) return { saved: 0 };

  const catalogByType = new Map(ARCHITECT_NODE_CATALOG.map((item) => [item.type, item]));
  const existingRows = await prisma.architectNodeVisibility.findMany({
    where: { nodeType: { in: allowed.map((item) => item.type) } },
    select: { nodeType: true, visible: true, label: true, group: true }
  });
  const existingByType = new Map(existingRows.map((row) => [row.nodeType, row]));

  await prisma.$transaction(
    allowed.map((item) => {
      const catalog = catalogByType.get(item.type);
      const existing = existingByType.get(item.type);
      const visible = item.visible ?? existing?.visible ?? catalog?.defaultVisible ?? true;
      const label = item.label !== undefined ? trimOverride(item.label) : (existing?.label ?? null);
      const group = item.group !== undefined ? trimOverride(item.group) : (existing?.group ?? null);
      return prisma.architectNodeVisibility.upsert({
        where: { nodeType: item.type },
        create: { nodeType: item.type, visible, label, group },
        update: { visible, label, group }
      });
    })
  );

  await Promise.all(
    allowed
      .map((item) => (item.group !== undefined ? trimOverride(item.group) : null))
      .filter((name): name is string => Boolean(name))
      .map((name) => rememberCustomGroup(name))
  );

  invalidateArchitectNodeVisibilityCache();
  return { saved: allowed.length };
}

const catalogGroupSet = new Set(ARCHITECT_NODE_GROUP_ORDER);

export async function listArchitectNodeGroups(): Promise<string[]> {
  const [stored, assigned] = await Promise.all([
    prisma.architectNodeGroup.findMany({
      select: { name: true },
      orderBy: { createdAt: "asc" }
    }),
    prisma.architectNodeVisibility.findMany({
      where: { group: { not: null } },
      select: { group: true },
      distinct: ["group"]
    })
  ]);
  const extras: string[] = [];
  for (const name of [...stored.map((row) => row.name), ...assigned.map((row) => row.group)]) {
    const value = name?.trim();
    if (value && !catalogGroupSet.has(value) && !extras.includes(value)) extras.push(value);
  }
  return extras;
}

export async function createArchitectNodeGroup(name: string): Promise<{ groups: string[]; created: boolean }> {
  const trimmed = name.trim();
  if (!trimmed) return { groups: await listArchitectNodeGroups(), created: false };
  if (catalogGroupSet.has(trimmed)) {
    return { groups: await listArchitectNodeGroups(), created: false };
  }
  const existing = await prisma.architectNodeGroup.findFirst({
    where: { name: { equals: trimmed, mode: "insensitive" } }
  });
  if (existing) return { groups: await listArchitectNodeGroups(), created: false };
  await prisma.architectNodeGroup.create({ data: { name: trimmed } });
  return { groups: await listArchitectNodeGroups(), created: true };
}

async function rememberCustomGroup(name: string | null): Promise<void> {
  if (!name || catalogGroupSet.has(name)) return;
  await prisma.architectNodeGroup.upsert({
    where: { name },
    create: { name },
    update: {}
  });
}

export async function deleteArchitectNodeGroup(
  name: string
): Promise<{ groups: string[]; moved: number; deleted: boolean }> {
  const trimmed = name.trim();
  if (!trimmed || catalogGroupSet.has(trimmed)) {
    return { groups: await listArchitectNodeGroups(), moved: 0, deleted: false };
  }

  const [groupRow, assigned] = await Promise.all([
    prisma.architectNodeGroup.findFirst({
      where: { name: { equals: trimmed, mode: "insensitive" } }
    }),
    prisma.architectNodeVisibility.findMany({
      where: { group: { equals: trimmed, mode: "insensitive" } },
      select: { nodeType: true, group: true }
    })
  ]);

  if (!groupRow && assigned.length === 0) {
    return { groups: await listArchitectNodeGroups(), moved: 0, deleted: false };
  }

  await prisma.$transaction(async (tx) => {
    await tx.architectNodeVisibility.updateMany({
      where: { group: { equals: trimmed, mode: "insensitive" } },
      data: { group: null }
    });
    if (groupRow) {
      await tx.architectNodeGroup.delete({ where: { id: groupRow.id } });
    }
  });

  invalidateArchitectNodeVisibilityCache();
  return {
    groups: await listArchitectNodeGroups(),
    moved: assigned.length,
    deleted: true
  };
}

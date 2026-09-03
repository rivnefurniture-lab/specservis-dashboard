export type TenderDirectionGroupId = "construction" | "service-climate";

export const TENDER_DIRECTION_GROUPS: Array<{
  id: TenderDirectionGroupId;
  label: string;
  directions: string[];
}> = [
  {
    id: "construction",
    label: "Будівельні",
    directions: ["construction", "design", "Капбудівництво"],
  },
  {
    id: "service-climate",
    label: "Сервіс і кондиціонування",
    directions: ["service", "Сервіс", "conditioning", "ventilation", "Кондиціонування"],
  },
];

const byId = new Map(TENDER_DIRECTION_GROUPS.map((group) => [group.id, group]));

export function directionGroupFor(value: string | null | undefined) {
  if (!value) return null;
  return TENDER_DIRECTION_GROUPS.find((group) => group.directions.includes(value)) ?? null;
}

export function directionGroupIdFor(value: string | null | undefined): TenderDirectionGroupId | null {
  return directionGroupFor(value)?.id ?? null;
}

export function expandDirectionGroups(values: string[]) {
  const expanded = values.flatMap((value) => byId.get(value as TenderDirectionGroupId)?.directions ?? [value]);
  return [...new Set(expanded)];
}

export function directionsForAccount(value: string | null | undefined) {
  return directionGroupFor(value)?.directions ?? (value ? [value] : []);
}

export function collapseDirectionRows(rows: Array<{ id: string; slug: string; label: string; primary: boolean }>) {
  return TENDER_DIRECTION_GROUPS.flatMap((group) => {
    const matches = rows.filter((row) => group.directions.includes(row.id) || group.directions.includes(row.slug) || group.directions.includes(row.label));
    return matches.length ? [{
      id: group.id,
      slug: group.id,
      label: group.label,
      primary: matches.some((row) => row.primary),
    }] : [];
  });
}

import {
  AtSign, Biohazard, Bug, Building2, Flag, FileWarning, Globe, Monitor, UserRound, Circle,
  type LucideIcon,
} from 'lucide-react';

// Identity for each entity type. Color comes from CSS tokens (--c-<Label>) so
// light/dark steps swap in one place; the icon carries identity too, so color
// is never the only cue.
export interface EntityMeta {
  label: string;
  singular: string;
  plural: string;
  icon: LucideIcon;
  color: string; // CSS var reference
}

const def = (label: string, singular: string, plural: string, icon: LucideIcon): EntityMeta => ({
  label, singular, plural, icon, color: `var(--c-${label})`,
});

export const ENTITY_META: Record<string, EntityMeta> = {
  ThreatActor: def('ThreatActor', 'Threat Actor', 'Threat Actors', UserRound),
  Malware: def('Malware', 'Malware', 'Malware', Biohazard),
  Campaign: def('Campaign', 'Campaign', 'Campaigns', Flag),
  Organization: def('Organization', 'Organization', 'Organizations', Building2),
  Vulnerability: def('Vulnerability', 'Vulnerability', 'Vulnerabilities', Bug),
  IPAddress: def('IPAddress', 'IP Address', 'IP Addresses', Monitor),
  Domain: def('Domain', 'Domain', 'Domains', Globe),
  Email: def('Email', 'Registrant e-mail', 'Registrant e-mails', AtSign),
  Incident: def('Incident', 'Incident', 'Incidents', FileWarning),
};

export const ENTITY_ORDER = [
  'ThreatActor', 'Campaign', 'Malware', 'Vulnerability', 'Organization', 'Incident', 'IPAddress', 'Domain', 'Email',
];

export function metaFor(label: string): EntityMeta {
  return ENTITY_META[label] ?? def(label, label, label, Circle);
}

// One-line secondary text for an entity, used under its name in cards and lists.
export function subtitleFor(label: string, p: Record<string, unknown>): string {
  const s = (v: unknown) => (v === undefined || v === null || v === '' ? null : String(v));
  const parts: (string | null)[] = (() => {
    switch (label) {
      case 'ThreatActor': return [s(p.motivation), s(p.origin)];
      case 'Malware': return [s(p.malwareType)];
      case 'Campaign': return [s(p.status), Array.isArray(p.sectors) ? (p.sectors as string[]).join(', ') : null];
      case 'Organization': return [s(p.sector), s(p.city)];
      case 'Vulnerability': return [p.cvss != null ? `CVSS ${p.cvss}` : null, s(p.product)];
      case 'IPAddress': return [s(p.hostingProvider), s(p.country)];
      case 'Domain': return [s(p.registrar)];
      case 'Email': return ['domain registrant'];
      case 'Incident': return [s(p.incidentType), s(p.severity)];
      default: return [];
    }
  })();
  return parts.filter(Boolean).join(' · ');
}

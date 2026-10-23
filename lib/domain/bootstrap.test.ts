import { expect, it } from 'vitest';
import {
  bootstrapManifestVersion,
  bootstrapMilestones,
  bootstrapOrders,
} from './bootstrap';

it('LUUFI-18 bewahrt die veröffentlichten Kennungen und ihren ursprünglichen Umfang bei späteren Folgeaufträgen', () => {
  expect(bootstrapManifestVersion).toBe('1.0.0');
  expect(bootstrapOrders.map((o) => [o.number, o.id, o.spec.title])).toEqual([
    [1, 'bootstrap-luufi-order-1', 'Nativer MCP-Nachweis'],
    [2, 'bootstrap-luufi-order-2', 'Bereinigte Grundlage'],
    [3, 'bootstrap-luufi-order-3', 'Eigenständige Projektideen'],
    [
      4,
      'bootstrap-luufi-order-4',
      'Projekte und gemeinsame Planungspersistenz',
    ],
    [5, 'bootstrap-luufi-order-5', 'Geordnete Milestones'],
    [6, 'bootstrap-luufi-order-6', 'Versionierte Entwurfsaufträge'],
    [7, 'bootstrap-luufi-order-7', 'Auftragszuordnung und Beziehungen'],
    [8, 'bootstrap-luufi-order-8', 'Projekt- und Milestone-Leseansichten'],
    [9, 'bootstrap-luufi-order-9', 'Lesbare Aufträge mit Filtern und Historie'],
    [10, 'bootstrap-luufi-order-10', 'Projektfeedback und Refinementquellen'],
    [11, 'bootstrap-luufi-order-11', 'Private Medien und sichere Wiederholung'],
    [
      12,
      'bootstrap-luufi-order-12',
      'Mobile Feedbackeingabe und Uploadfortschritt',
    ],
    [
      13,
      'bootstrap-luufi-order-13',
      'Freigabe und exklusive Auftragsbearbeitung',
    ],
    [
      14,
      'bootstrap-luufi-order-14',
      'Tatsächliche Gitprüfung und Abschlussnachweise',
    ],
    [
      15,
      'bootstrap-luufi-order-15',
      'Lesbare Freigaben, Fortschritt und Nachweise',
    ],
    [
      16,
      'bootstrap-luufi-order-16',
      'Versionen, Änderungen, Builds und Releases',
    ],
    [17, 'bootstrap-luufi-order-17', 'Versionen und Bereitstellungen lesen'],
    [
      18,
      'bootstrap-luufi-order-18',
      'Bootstrap und geprüfte Wiederherstellung',
    ],
  ]);
  expect(
    bootstrapMilestones.map((m) => [
      m.id,
      bootstrapOrders
        .filter((o) => o.milestoneId === m.id)
        .map((o) => o.number),
    ]),
  ).toEqual([
    ['bootstrap-luufi-foundation', [1, 2, 3]],
    ['bootstrap-luufi-planning', [4, 5, 6, 7, 8, 9]],
    ['bootstrap-luufi-feedback', [10, 11, 12]],
    ['bootstrap-luufi-execution', [13, 14, 15]],
    ['bootstrap-luufi-versions', [16, 17, 18]],
  ]);
});

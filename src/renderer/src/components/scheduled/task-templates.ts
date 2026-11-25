import { BookOpenCheckIcon, FlaskConicalIcon, GitPullRequestIcon, HammerIcon, ListChecksIcon, PackageSearchIcon, ScrollTextIcon, SunIcon } from '@lucide/vue'
import type { Component } from 'vue'
import type { TaskSchedule } from '@shared/scheduled-tasks'

/**
 * Starting points for a scheduled task, for agents that work in a project's folder (Claude Desktop's
 * templates are about mail and calendars; Nexa's agents have a repository). A template only fills
 * the dialog: CLI, account, permissions and project are picked there.
 */
export interface TaskTemplate {
  id: string
  icon: Component
  name: string
  description: string
  prompt: string
  schedule: TaskSchedule
}

export const TASK_TEMPLATES: TaskTemplate[] = [
  {
    id: 'overview',
    icon: SunIcon,
    name: 'Überblick am Morgen',
    description: 'Was sich seit gestern im Repository getan hat und was heute Aufmerksamkeit braucht.',
    prompt:
      'Verschaff dir einen Überblick über das Repository in diesem Ordner: Was hat sich seit gestern geändert (Commits, Branches, nicht committete Änderungen)? Sind neue TODO- oder FIXME-Kommentare dazugekommen? Fasse es kurz zusammen und nenne, was heute Aufmerksamkeit braucht. Ändere nichts.',
    schedule: { kind: 'weekdays', time: '08:00' },
  },
  {
    id: 'pull-requests',
    icon: GitPullRequestIcon,
    name: 'Offene Pull Requests',
    description: 'Status der Checks und Reviews, was auf dich wartet und was blockiert ist.',
    prompt:
      'Liste mit `gh pr list` und `gh pr view` die offenen Pull Requests dieses Repositorys auf: Status der Checks, Reviews, wie lange sie schon offen sind. Fasse zusammen, was auf mich wartet und was blockiert ist. Ändere nichts auf GitHub.',
    schedule: { kind: 'weekdays', time: '09:00' },
  },
  {
    id: 'build-tests',
    icon: HammerIcon,
    name: 'Build und Tests',
    description: 'Baut das Projekt, lässt die Tests laufen und meldet, was fehlschlägt.',
    prompt:
      'Führe den Build und die Tests dieses Projekts aus (die Befehle stehen in package.json, Makefile, README o. Ä.). Melde, was fehlschlägt, mit der wahrscheinlichen Ursache. Behebe nichts, schlag nur vor.',
    schedule: { kind: 'daily', time: '07:30' },
  },
  {
    id: 'dependencies',
    icon: PackageSearchIcon,
    name: 'Abhängigkeiten prüfen',
    description: 'Veraltete Pakete, Sicherheitslücken und Breaking Changes größerer Updates.',
    prompt:
      'Prüfe die Abhängigkeiten dieses Projekts auf veraltete Pakete und bekannte Sicherheitslücken (z. B. `npm outdated` und `npm audit`, je nach Paketmanager). Nenne bei größeren Updates die Breaking Changes. Ändere nichts, schlag nur vor, was sich lohnt.',
    schedule: { kind: 'weekly', days: [1], time: '09:15' },
  },
  {
    id: 'issues',
    icon: ListChecksIcon,
    name: 'Issue-Triage',
    description: 'Neue Issues einordnen: Bug, Feature oder Frage, Dringlichkeit und Labels.',
    prompt:
      'Sieh dir mit `gh issue list` die Issues an, die seit gestern dazugekommen sind. Ordne jedes als Bug, Feature-Wunsch oder Frage ein, schätze die Dringlichkeit und schlag Labels vor. Ändere nichts auf GitHub.',
    schedule: { kind: 'weekdays', time: '08:30' },
  },
  {
    id: 'flaky-tests',
    icon: FlaskConicalIcon,
    name: 'Instabile Tests',
    description: 'Tests, die in den CI-Läufen der letzten Woche mal bestehen und mal nicht.',
    prompt:
      'Sieh dir mit `gh run list` und `gh run view` die CI-Läufe der letzten sieben Tage an. Finde Tests, die mal bestehen und mal fehlschlagen, und nenne sie mit Häufigkeit und vermuteter Ursache.',
    schedule: { kind: 'weekly', days: [1], time: '09:45' },
  },
  {
    id: 'release-notes',
    icon: ScrollTextIcon,
    name: 'Versionshinweise entwerfen',
    description: 'Aus den Commits seit dem letzten Tag, in Worten für Nutzer.',
    prompt:
      'Entwirf Versionshinweise für Nutzer aus den Commits seit dem letzten Tag (`git describe --tags`, `git log`): was neu ist, was besser wurde, was behoben ist. Kurz, in einfachen Worten, ohne interne Details. Schreib nichts in Dateien.',
    schedule: { kind: 'manual' },
  },
  {
    id: 'docs',
    icon: BookOpenCheckIcon,
    name: 'Dokumentation prüfen',
    description: 'Was in README und Doku nicht mehr zum Code passt oder fehlt.',
    prompt:
      'Vergleiche README und Dokumentation dieses Projekts mit dem aktuellen Code: Was ist veraltet, was fehlt, welche Beispiele laufen nicht mehr? Liste die Stellen mit Vorschlägen auf. Ändere nichts.',
    schedule: { kind: 'weekly', days: [5], time: '15:00' },
  },
]

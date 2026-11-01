# CLAUDE.md — cronotermostato (integrazione Home Assistant, HACS)

## Cos'è
Integrazione HA personalizzata `cronotermostato`: programmi settimanali riusabili (fasce con modo e temperatura, parte
festivi per nazione), assegnati a più stanze `climate`, forzatura manuale. È la parte 1 di 3; l'editor in HA (parte 2) e
il tile Tessera (parte 3, repository separato `tessera-cronotermostato`) hanno piani a parte, da scrivere dopo.

## Da leggere prima di lavorare
- Progetto: `docs/superpowers/specs/2026-11-01-cronotermostato-design.md` (le decisioni di Alex sono marcate "deciso").
- Piano di costruzione: `docs/superpowers/plans/2026-11-01-cronotermostato-integrazione.md` (12 passi, test per passo).

## Come si esegue
Alex ha scelto l'esecuzione **con agenti** (`superpowers:subagent-driven-development`): un agente nuovo per passo, un
revisore prima del passo successivo, revisione finale del ramo.

## Regole (da Alex)
- Si parla in italiano. Commit in italiano, con le righe di attribuzione richieste dal sistema.
- **Non fare push, non creare il repository su GitHub, non pubblicare release e non comandare termostati reali** senza
  chiedere: il passo 12 lo dice esplicitamente.
- Home Assistant è `core-2026.10.4` su Python 3.14.9; in locale c'è Python 3.12, quindi i test girano in `.venv`
  creato con `uv venv --python 3.14` (`uv` è già installato).
- Le festività usano `holidays` (HA 2026.10.4 la fissa a `==0.106`).
- In HA c'è già lo **Scheduler** (HACS) che comanda 12 termostati: convivere, non toccarlo. Alex lo sostituirà una stanza
  alla volta.
- Identità Git locale di questo repo già impostata (come `tessera-thermo-dial`).

## Repository collegati
`~/tessera-thermo-dial` (plugin Tessera da cui prende spunto il tile), `~/tessera-plugins` (regole dei plugin),
`~/espscreen` (firmware Tessera), `~/pannello` (progetto del pannello, con la memoria delle sessioni precedenti).

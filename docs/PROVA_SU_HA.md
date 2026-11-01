# Prova su Home Assistant (verifiche manuali)

Prima di iniziare: la stanza di prova e' **una sola**, `climate.termostato_casa` (dichiara `min_temp` 15, `max_temp` 25, `hvac_modes` heat/off). Durante
tutta la prova si assegna il programma solo a quella stanza. Lo Scheduler resta com'e'
e non si tocca; la stanza di prova va tolta dallo Scheduler (o se ne disattiva solo la
regola di quella stanza) per tutta la durata, altrimenti i due si sovrascrivono.

Stanza di prova: `climate.termostato_casa`   Data: ______

## 0. Installazione

- [ ] Copiare `custom_components/cronotermostato` in `/config/custom_components/` e riavviare HA.
- [ ] Impostazioni -> Dispositivi e servizi -> Aggiungi integrazione -> Cronotermostato.
- [ ] La nazione proposta e' quella di HA (Italia); scegliere o saltare la regione.
- [ ] Nessun errore nel log (Impostazioni -> Sistema -> Log) per `cronotermostato`.

## 1. Programma e assegnazione

- [ ] Strumenti per sviluppatori -> Azioni: `cronotermostato.create_program` con un programma di prova
      (una fascia che contiene l'ora attuale, temperatura vicina a quella attuale; una fascia dopo la
      successiva con temperatura diversa) e `response_variable`: l'id restituito e' atteso (es. `prova`).
- [ ] Compare `sensor.programma_<id>` con stato 0 e gli attributi `week`, `week_full`, `holiday`, `rooms`.
- [ ] `cronotermostato.assign` con la stanza di prova: compaiono `sensor.<stanza>_programma` e `switch.<stanza>_automatico`.
- [ ] Il termostato riceve modo e temperatura della fascia attuale (controllare l'entita' `climate`).
- [ ] `sensor.<stanza>_programma`: stato = nome del programma, `status: ok`, `manual: false`, `slot` e `next_slot` corretti.
- [ ] `sensor.programma_<id>` ora ha stato 1 e `rooms` contiene la stanza.
- [ ] Nessun altro termostato e' stato comandato.

## 2. Forzatura e ritorno in automatico

- [ ] `cronotermostato.set_manual` (heat, temperatura diversa): il termostato cambia; lo switch automatico va su `off`;
      `manual: true` e `override_until` = fine della fascia attuale.
- [ ] `cronotermostato.resume_auto`: lo switch torna `on`, il termostato torna alla fascia attuale.
- [ ] Ripetere spegnendo lo switch automatico dall'interfaccia (forza la fascia attuale), poi riaccendendolo.
- [ ] `set_manual` con `mode: off`: il termostato va in off, la temperatura e' ignorata.
- [ ] `set_manual` con `heat` senza temperatura: errore comprensibile.
- [ ] Lasciare una forzatura fino al cambio di fascia: alla fine della fascia lo switch torna `on` e la
      nuova fascia viene applicata.

## 3. Pausa

- [ ] `cronotermostato.pause`: `status: paused`; al cambio di fascia non parte nessun comando.
- [ ] `cronotermostato.resume`: viene riapplicata la fascia attuale.

## 4. Riavvio di HA durante una forzatura

- [ ] Impostare `set_manual` e verificare che il comando sia arrivato al termostato.
- [ ] Riavviare HA.
- [ ] Dopo il riavvio: `manual: true`, stesso `override_until`. Se il termostato era gia' disponibile all'avvio,
      nessun nuovo comando per la forzatura. Se all'avvio il `climate` era `missing`/`unavailable` (caso normale
      in un riavvio vero), quando torna disponibile il controllore applica la forzatura attiva: vedere comandi
      a quel punto e' normale.
- [ ] Riavviare HA a forzatura scaduta (o attendere la scadenza con HA spento): la forzatura e' sparita e
      viene applicata la fascia corrente.
- [ ] Riavvio senza forzatura: viene applicata la fascia corrente.

## 5. Cambio nazione (festivi)

- [ ] Integrazione -> Configura: cambiare nazione (e regione); l'integrazione si ricarica.
- [ ] `holiday` degli attributi riflette la nuova nazione (per esempio scegliendo un giorno festivo di una
      nazione in cui oggi e' festa); la fascia usata e' quella festiva.
- [ ] Rimettere la nazione originale.
- [ ] Una combinazione nazione/regione non valida viene rifiutata con un messaggio.

## 6. Termostato non raggiungibile

- [ ] Rendere il termostato non disponibile (spegnerlo/scollegarlo, o disabilitarne l'integrazione):
      `status: unavailable`, nessun comando.
- [ ] Al cambio di fascia mentre e' non disponibile non succede nulla di strano; quando torna viene
      applicata la fascia di quel momento.
- [ ] Modo non supportato (fascia `cool` su un termostato solo `heat`/`off`): `status: unsupported_mode`
      e un avviso nel log; il modo non cambia da solo.
- [ ] Limiti dal termostato (`climate.termostato_casa`: min 15, max 25). Fascia a 30 gradi: `status: out_of_range`,
      nessun comando (ne' modo ne' temperatura), un avviso nel log; al cambio fascia successivo (fascia
      entro 15-25) torna `ok` e viene applicata.
- [ ] `set_manual` a 30 gradi (e a 14): errore "fuori dai limiti" (`temperature_out_of_range`), nessuna forzatura
      salvata, nessun comando. `set_manual` a 25: riesce. Lo switch automatico spento su una fascia fuori limiti
      d'errore allo stesso modo.
- [ ] Preset (`climate.termostato_casa`: `none`, `away`, `comfort`, `eco`, `home`, `sleep`, `activity`). Fascia `heat`
      con **solo** preset `home`: il log/la cronologia mostra `set_hvac_mode` poi `set_preset_mode` e **nessun**
      `set_temperature`; `status: ok`, il termostato mostra il preset `home`; `slot.preset` negli attributi del sensore.
- [ ] Fascia con preset **non supportato** (per esempio `boost`): `status: unsupported_preset`, nessun comando (ne' modo
      ne' preset ne' temperatura), un solo avviso nel log; al cambio fascia successivo (fascia valida) torna `ok`.
- [ ] Fascia con preset **e** temperatura (per esempio `eco` + 20): l'ordine e' modo, preset, temperatura. Osservare se
      il termostato cambia da solo il preset dopo la temperatura (limite noto): in quel caso usare preset o temperatura
      da soli.
- [ ] `set_manual` con solo `preset: eco`: forza il preset fino a fine fascia; `set_manual` senza ne' preset ne'
      temperatura per `heat`: errore `invalid_program`. Lo switch automatico spento su una fascia con preset forza
      modo, preset e temperatura di quella fascia.
- [ ] Un valore entro i limiti ma rifiutato dal termostato: `status: error` e nessun nuovo tentativo fino al
      prossimo cambio fascia / ritorno disponibile / azione esplicita (limite noto).

## 7. Modifica e rimozione

- [ ] `update_program` (cambiare una temperatura della fascia attuale): la stanza la applica subito.
- [ ] `delete_program` con una stanza ancora assegnata: errore. Dopo `unassign` riesce, e le entita' sparite.
- [ ] `unassign`: spariscono le entita' della stanza; il termostato resta com'e'.

## 8. Convivenza

- [ ] Le altre stanze (Scheduler) continuano a funzionare come prima; il log non mostra comandi di
      Cronotermostato sugli altri termostati.

## Esito

Note e problemi trovati: ______

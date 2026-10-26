# Menú y Compras

App web para planear el menú de la semana (quién cocina, qué se come, ingredientes y notas) y armar las compras separadas por lugar (súper, verdulería, carnicería y los que se agreguen desde el botón de la bolsa).

- Página estática, sin build: `index.html`, `style.css`, `app.js`.
- Datos compartidos en vivo y login con mail y contraseña: Firebase (Firestore + Authentication), configurado en `firebase-config.js`.
- Reglas de acceso de Firestore: `firestore.rules` (se pegan en la consola de Firebase con los mails reales).
- Instalable en el celular (PWA): `manifest.webmanifest` y `sw.js`. Al publicar un cambio grande conviene subir la versión de `CACHE` en `sw.js`.
- Publicada con GitHub Pages desde la rama `main`.

Respaldo: en el menú de personas (ícono de arriba a la derecha) se puede descargar una copia en JSON e importarla.

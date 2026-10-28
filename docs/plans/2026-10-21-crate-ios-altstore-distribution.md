# Crate Listen iOS: distribución mediante AltStore

Fecha de referencia y consulta: **21 de octubre de 2026**. Estado: investigación y propuesta; no se ha publicado ninguna app ni registrado ninguna cuenta.

## Dictamen

**Sí, Crate Listen puede distribuirse mediante AltStore.** La opción recomendable para una distribución pública sin la revisión completa de la App Store es **AltStore PAL**, inicialmente en la UE. Sigue requiriendo una cuenta de pago de Apple, firma para distribución, App Store Connect y notarización. **AltStore Classic** sirve como canal voluntario para usuarios técnicos de cualquier país, con las limitaciones de firma de desarrollo del usuario. La aprobación de una versión concreta de Crate sigue pendiente.

Para una beta privada con usuarios que esperan instalar y escuchar sin mantenimiento semanal, recomiendo **TestFlight**. Para self-hosters: una única app configurable, PAL donde esté disponible y Classic como opción adicional mundial. Para distribución pública mundial y estable, habría que añadir la App Store; PAL por sí solo no ofrece ese alcance.

## 1. Hechos verificados: Classic frente a PAL

| Aspecto                        | AltStore Classic                                                            | AltStore PAL                                                                                      |
| ------------------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Alcance declarado por AltStore | Mundial                                                                     | UE, Japón y Brasil                                                                                |
| Artefacto que hospedamos       | IPA compilado para dispositivo                                              | Alternative Distribution Package (ADP) notarizado y procesado para PAL                            |
| Revisión de Apple              | No requiere notarización                                                    | Notarización; puede coexistir con distribución en App Store                                       |
| Cuenta de pago del editor      | AltStore no la exige                                                        | Apple Developer Program                                                                           |
| Firma de la instalación        | El usuario instala mediante su propia cuenta Apple y AltServer              | Flujo de distribución de Apple y marketplace; el usuario no firma con una cuenta de desarrollador |
| Caducidad                      | Con cuenta gratuita: siete días                                             | Sin renovación semanal por el usuario                                                             |
| Límite con cuenta gratuita     | Tres apps activas; diez App IDs por semana                                  | Sin el límite de tres apps                                                                        |
| Ordenador del usuario          | AltServer en macOS o Windows para instalar y refrescar mediante Wi-Fi o USB | No necesario                                                                                      |
| Capacidades                    | Dependen del perfil de desarrollo del usuario                               | Capacidades permitidas por Apple para la app y su distribución                                    |

La comparación y los canales están descritos por [AltStore Developers](https://developer.altstore.io/), la [guía de Classic](https://faq.altstore.io/developers/distribute-with-altstore-classic) y la [guía de PAL](https://faq.altstore.io/developers/distribute-with-altstore-pal).

En Classic, la firma gratuita caducada impide abrir la app hasta refrescarla. La renovación en segundo plano es un intento, no una garantía: depende de poder contactar con AltServer. Los App IDs de las extensiones también consumen cuota. Véanse [Getting Started](https://faq.altstore.io/altstore-classic/your-altstore), [AltServer](https://faq.altstore.io/altstore-classic/altserver) y [App IDs](https://faq.altstore.io/altstore-classic/app-ids). Los límites gratuitos no deben presentarse como universales para todas las cuentas; AltStore documenta que una cuenta de pago elimina el límite gratuito de apps en sus [códigos de error](https://faq.altstore.io/altstore-classic/error-codes). No basaría el soporte general de Crate en que cada oyente pague una cuenta Apple.

La instalación Classic requiere confiar en el perfil del usuario y activar Developer Mode en iOS 16 o posterior. El procedimiento oficial pide credenciales Apple en AltServer; Crate no tendría que recibirlas. [Instalación en macOS](https://faq.altstore.io/altstore-classic/how-to-install-altstore-macos).

**Distinción importante:** alojar un IPA para que cada usuario lo vuelva a firmar mediante Classic no equivale a publicar en un marketplace autorizado por Apple. La propia [tabla de capacidades de Apple](https://developer.apple.com/help/account/reference/supported-capabilities-ios) distingue las cuentas gratuitas, que no habilitan la distribución ordinaria de apps. Classic es una ruta de sideloading ofrecida por AltStore, con un modelo operativo diferente al de PAL.

## 2. Territorios, versiones e instalación real de PAL

Hay que distinguir el soporte del sistema operativo, lo que anuncia AltStore y la aprobación individual de Crate:

| Territorio | Lo que permite Apple                                            | Lo que declara AltStore PAL                                             |
| ---------- | --------------------------------------------------------------- | ----------------------------------------------------------------------- |
| UE         | Marketplaces en iPhone desde iOS 17.4 y en iPad desde iPadOS 18 | Disponible; su página de descarga actual pide iOS/iPadOS 18.0+          |
| Japón      | Marketplaces de apps de iPhone desde iOS 26.2                   | Disponible; notas de PAL 2.2.2 del 17-12-2025 confirman soporte inicial |
| Brasil     | Marketplaces de apps de iPhone desde iOS 26.5                   | Disponible; PAL 2.3.2 del 15-06-2026 incorpora localización brasileña   |
| Resto      | Estas rutas regionales no habilitan instalaciones PAL           | Classic sigue siendo la opción AltStore mundial                         |

Fuentes: [Apple: marketplaces en la UE](https://developer.apple.com/support/alternative-app-marketplace-in-the-eu/), [Apple: Japón](https://developer.apple.com/support/app-distribution-in-japan/), [Apple: Brasil](https://developer.apple.com/support/app-distribution-in-brazil/), [descarga de PAL](https://altstore.io/download) y [notas de versión de PAL](https://faq.altstore.io/release-notes/altstore-pal). La disponibilidad de iPad en la UE no debe extrapolarse a Japón o Brasil.

El país de la cuenta Apple y la ubicación física deben cumplir los requisitos regionales. Estar en España es suficiente para la parte territorial si la cuenta también tiene una región de la UE. Al salir de la región, Apple permite seguir usando apps ya instaladas y actualizarlas durante hasta 90 días; la instalación de marketplaces y apps nuevas requiere estar en la región elegible. [Disponibilidad de Apple](https://support.apple.com/en-us/118110).

El usuario instala PAL desde su web, autoriza el marketplace según las indicaciones de iOS, añade la URL de nuestra source y elige Crate. Las pantallas exactas varían por territorio y versión. Las actualizaciones pueden gestionarse con las opciones de actualización del sistema; borrar PAL impide recibir actualizaciones desde él. [Instalación y actualizaciones según Apple](https://support.apple.com/en-us/117767), [actualización del propio PAL](https://faq.altstore.io/altstore-pal/updating-altstore-pal).

**Límite de lo verificado:** AltStore anuncia y documenta publicación en los tres territorios. No se ha instalado PAL en dispositivos de esas regiones ni se ha enviado Crate. Esa documentación acredita una ruta disponible, no una aceptación anticipada de nuestra app.

## 3. Firma, notarización, requisitos y costes

### Requisitos del editor

Para PAL se necesita una membresía Apple Developer Program, que admite persona física u organización. El precio publicado es **99 USD por año**, con precio local variable y posibles exenciones para entidades elegibles. Una organización requiere identidad jurídica y normalmente D-U-N-S. No se ha comprobado el estado de ninguna cuenta de Crate. [Inscripción de Apple](https://developer.apple.com/programs/enroll/).

El flujo de subida a App Store Connect usa un App ID explícito, un certificado de distribución y un perfil correspondiente; Xcode puede administrar el perfil automáticamente. No sirve una compilación para simulador ni la firma ad hoc de macOS. [Perfiles de App Store Connect](https://developer.apple.com/help/account/provisioning-profiles/create-an-app-store-provisioning-profile/).

Después se registra el Developer ID con AltStore, se incorpora su token de marketplace en App Store Connect y se autoriza la app. Se envía la versión para notarización, se obtiene el ADP procesado por AltStore y se hospeda junto con la source. El editor puede estar fuera de las regiones admitidas. [Publicación PAL](https://faq.altstore.io/developers/distribute-with-altstore-pal), [API de AltStore](https://faq.altstore.io/developers/rest-api).

**Publicar Crate en PAL no implica operar nuestro propio marketplace.** Los requisitos financieros especiales que Apple impone a operadores de marketplaces no son una condición para listar una app en AltStore.

La notarización comprueba un subconjunto de las normas de Apple; no sustituye el proceso completo de App Review. La selección se hace por versión. [Envío para notarización](https://developer.apple.com/help/app-store-connect/managing-alternative-distribution/submit-for-notarization/). AltStore también exige descripción y capturas fieles, derechos sobre contenido y funcionalidad y cumplimiento de sus términos; se reserva la posibilidad de retirar apps. [App Guidelines](https://altstore.io/app-guidelines.html), [Developer Terms](https://altstore.io/developer-terms.html).

### Costes vigentes al día de referencia

| Concepto                                                              | Consecuencia para Crate                                                                                                  |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Comisión de AltStore                                                  | 0%; no tarifa de distribución publicada para Classic o PAL                                                               |
| Apple Developer Program                                               | Presupuestar 99 USD/año o el precio local aplicable para PAL/TestFlight                                                  |
| App gratuita y servicio propio gratuito, sin ventas digitales sujetas | No habría base de comisión CTC; siguen existiendo membresía y alojamiento                                                |
| App de pago, acceso de pago o ventas digitales sujetas mediante PAL   | Apple publica CTC del 5% en UE, Japón y Brasil; exige revisar y cumplir las obligaciones de declaración correspondientes |
| Hospedaje de IPA/ADP, source e imágenes                               | Coste propio de almacenamiento y transferencia                                                                           |

Fuentes económicas: [tarifas de AltStore](https://faq.altstore.io/developers/fees), [Apple: términos UE](https://developer.apple.com/support/apps-in-the-eu/), [Apple: Japón](https://developer.apple.com/support/app-distribution-in-japan/), [Apple: Brasil](https://developer.apple.com/support/app-distribution-in-brazil/).

**Cambio de fecha relevante:** el acuerdo Apple revisado el 18-08-2026 introdujo términos UE unificados efectivos desde el **01-10-2026**. Sustituyen el antiguo Core Technology Fee por instalación por CTC. AltStore lo confirmó en su [publicación del 14-10-2026](https://blog.altstore.io/2026/10/14/big-changes-to-alternative-distribution.html). Por tanto, el antiguo cálculo de 0,50 EUR por instalación anual y el antiguo addendum separado no son el presupuesto correcto para una publicación nueva bajo esos términos.

Las comisiones dependen del canal, territorio, transacción y contrato aplicables. El 5% no es una comisión sobre toda la actividad del servidor ni sobre instalaciones gratuitas. Si se cobra por alojamiento, acceso a bibliotecas, contenido, una suscripción o membresía que habilita la app, habrá que clasificar ese flujo antes de publicar: Apple incluye determinadas ventas que permiten acceder a apps o contenido y ciertas ventas externas enlazadas. Las exenciones para pequeños **operadores de marketplaces** no deben atribuirse automáticamente al editor de Crate. Las tarifas App Store son otro régimen.

## 4. Observaciones verificadas en este repositorio

Inspección de configuración y código públicos en el worktree `crate-v3-1q/crate`, HEAD `4085cd12179f1fd88c08faff479806463068a3e9`. No se han leído archivos de secretos ni consultado cuentas Apple o GitHub.

| Hallazgo                                             | Evidencia local                                                                                | Implicación                                                                                  |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Ya existe app Capacitor 8 con proyecto iOS           | `app/listen/package.json`, `app/listen/ios/App/`                                               | No hace falta reescribir Listen como app Swift                                               |
| Interfaz incluida en el bundle local                 | `app/listen/capacitor.config.ts`, `webDir: "dist"`, sin `server.url` remoto                    | La distribución puede empaquetar la UI y conservar el servidor configurable                  |
| Identificadores distintos                            | Capacitor: `app.cratemusic.crate`; Xcode Debug y Release: `org.lespedants.crate.listen`        | Resolver la identidad canónica y cualquier instalación previa antes de registrar/publicar    |
| CI solo compila simulador                            | `.github/workflows/build-ios.yml:105`, SDK `iphonesimulator`, Debug, `CODE_SIGNING_ALLOWED=NO` | Falta archive de dispositivo, exportación/subida, IPA instalable y publicación de artefactos |
| Mínimo del proyecto: iOS 16.4                        | `App.xcodeproj/project.pbxproj`, `Podfile`                                                     | El mínimo efectivo PAL será mayor según región y versión de PAL                              |
| Servidor configurable y sesiones por servidor        | `src/lib/platform.ts`, `src/lib/server-store.ts`, `src/pages/ServerSetup.tsx`                  | Una app puede atender a distintas instalaciones Crate                                        |
| HTTPS exigido                                        | `server-store.ts` y `scripts/assert-release-mobile-config.mjs`; release impide mixed content   | Una instancia HTTP de LAN no pasa a ser compatible por instalar desde AltStore               |
| Sesión nativa en Keychain y OAuth por esquema propio | `CrateSecureSessionStore.swift`, `src/lib/capacitor-oauth.ts`, `Info.plist`                    | Probar persistencia al actualizar/refirmar y retorno `cratemusic://oauth/callback`           |
| Associated Domains declarados                        | `App.entitlements`: dominios Listen de producción y desarrollo                                 | Classic gratuito requiere atención; no puede asumirse que conservará esos entitlements       |
| Audio en background y descubrimiento Cast declarados | `Info.plist`: modo audio, Bonjour y uso de red local                                           | Verificar en iPhone real bajo el canal de firma elegido                                      |

La [documentación oficial de Capacitor](https://capacitorjs.com/docs/ios) confirma que genera una app iOS gestionada por Xcode con WKWebView. La compatibilidad con PAL es una **inferencia técnica** a partir de ese formato y del flujo de distribución; no se encontró una certificación específica de AltStore para Crate/Capacitor.

La tabla de Apple permite background modes con cuenta gratuita, pero no Associated Domains. **Inferencia:** para un IPA Classic orientado a cuentas gratuitas puede hacer falta una variante sin entitlements incompatibles, conservando el retorno OAuth mediante el esquema propio. Hay que probarlo antes de prometer esa ruta; quitar un entitlement del texto de una source no modifica correctamente firma, perfil o binario.

**Inferencia para self-hosting:** no hace falta una app, source o cuenta Apple por cada servidor. La source distribuye software; el usuario elige una instancia HTTPS dentro de la app. La geografía de PAL afecta a la instalación de la app, no determina dónde debe alojarse el servidor Crate. El funcionamiento contra cada instancia sigue dependiendo de conectividad, TLS, configuración del servidor y compatibilidad de API.

## 5. Elección por escenario

| Necesidad                                                | Canal propuesto                    | Motivo y límite                                                                                                                                 |
| -------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Desarrollo propio o prueba técnica de muy pocas personas | Xcode o Classic                    | Iteración rápida; sirve para comprobar re-firma, capacidades y refresh                                                                          |
| Beta privada de usuarios normales                        | TestFlight por invitación          | Gestión de testers y actualizaciones sin AltServer; las builds duran hasta 90 días y los testers externos requieren el proceso de revisión beta |
| Self-hosters técnicos en cualquier país                  | IPA Classic opcional               | Alcance mundial; explicar ordenador, firma, caducidad y soporte limitado de capacidades                                                         |
| Usuarios de self-hosting en regiones elegibles           | PAL con app configurable           | Instalación persistente y actualizaciones sin mantenimiento semanal                                                                             |
| Público UE, después Japón/Brasil                         | PAL como canal alternativo estable | Notarización y operación regional verificadas; probar cada región antes de anunciar soporte                                                     |
| Público mundial con instalación estable                  | App Store además de PAL            | Requiere revisión completa; Classic no sustituye esa experiencia                                                                                |

Apple admite hasta 100 testers internos con acceso al equipo y hasta 10.000 externos; no hay que recopilar UDIDs para TestFlight. La beta externa puede distribuirse por invitación sin abrir un enlace público. [TestFlight](https://developer.apple.com/testflight/), [duración y flujo de builds](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/).

Una source sin promoción no constituye un control de acceso de beta privada. AltStore permite añadir una source por URL y la publicación en su directorio es opcional. **Inferencia:** una URL compartida puede circular; para una beta con invitados, TestFlight es un ajuste mejor. [Descubribilidad de sources](https://faq.altstore.io/developers/source-discoverability). AltStore documenta [restricciones con Patreon](https://faq.altstore.io/developers/patreon-integration), pero añadir una membresía de pago para resolver la beta introduciría otra dependencia y posibles transacciones sujetas a comisión.

## 6. Pasos concretos para ejecutar después de esta investigación

1. **Decidir identidad y canal inicial.** Confirmar si existe un App ID o alguna instalación firmada previa. Elegir el bundle ID definitivo y mantenerlo coherente en Capacitor, Xcode, firma, metadata y source. Mi propuesta: TestFlight privado primero; PAL UE como primera publicación estable; Classic opcional después de probar sus capacidades.
2. **Preparar un archive real en macOS.** Usar una versión de Xcode compatible con Capacitor y con los requisitos de subida vigentes; compilar Release para dispositivo. Para TestFlight/PAL, configurar certificado y perfil de distribución de forma protegida. Para Classic, producir y comprobar un IPA de dispositivo que AltStore pueda re-firmar. No reutilizar el resultado del simulador.
3. **Validar el IPA y la identidad.** Comprobar arquitectura de dispositivo, `CFBundleIdentifier`, versión/build, firma, perfil y entitlements efectivos. Instalar en un iPhone; probar actualización conservando la sesión, configuración de servidor y descargas offline.
4. **Cerrar la prueba funcional.** HTTPS de instancia propia y de otra instancia, cambio de servidor, login/logout y refresh de sesión; OAuth con retorno a la app; reproducción con pantalla bloqueada, interrupciones y auriculares; descargas y playback offline; Cast y permiso de red local. En Classic añadir expiración/refresh y re-firma con cuenta gratuita. Conservar las pruebas de bridge existentes y añadir regresiones si se cambia implementación.
5. **Preparar el expediente PAL.** Cuenta Apple vigente y contrato aplicable; app en App Store Connect; metadata, capturas, edad, privacidad y permisos fieles; acceso de revisión a una instancia de demostración con contenido autorizado. Revisar los SDK y manifiestos de privacidad que correspondan al archive final. Documentar el uso de biblioteca propia y las funciones visibles que se envían a revisión.
6. **Conectar PAL y notarizar.** Registrar Developer ID mediante la API oficial, incorporar el token de AltStore en App Store Connect, autorizar Crate y activar notificaciones. Enviar la versión a notarización y esperar su aprobación. No se necesita solicitar entitlement de operador de marketplace para Crate.
7. **Hospedar artefactos y source de staging.** Classic apunta a un `.ipa`; PAL al `manifest.json` o raíz de su ADP. En PAL preservar estructura y bytes de todos los ficheros. Publicar metadata, permisos, versión/build y mínimo de sistema coherentes. Puede usarse hosting estático; es independiente del almacenamiento musical de los usuarios.
8. **Probar instalación y actualización por source.** Añadir la URL manualmente a Classic/PAL, instalar una versión y actualizar a otra. Publicar primero el artefacto y después la source; AltStore detecta actualizaciones por el primer elemento compatible de `versions`, no por la fecha. [Formato de source](https://faq.altstore.io/developers/make-a-source), [actualizaciones](https://faq.altstore.io/developers/updating-apps).
9. **Publicar el canal acordado.** Hacer visible la source estable solo después de esas pruebas. La federación y aparición en `explore.alt.store` son optativas. Mantener instrucciones separadas para Classic/PAL, versiones archivadas, soporte de actualizaciones y presupuesto de transferencia. Ampliar Japón/Brasil cuando se haya validado instalación en cada región.

## 7. Decisiones y verificaciones pendientes

- Titular y estado de la membresía Apple; aceptar los términos vigentes corresponde al Account Holder. No se ha accedido a esa cuenta.
- Bundle ID canónico y continuidad con instalaciones previas; el desajuste del repositorio es un bloqueo previo a publicar.
- Beta inicial por TestFlight o aceptación explícita de la fricción Classic; regiones de lanzamiento y necesidad de App Store mundial.
- App y acceso gratuitos o modelo comercial concreto, para determinar las obligaciones de comisión y declaración del canal elegido.
- IPA real y hardware para probar firma, actualización, audio, offline, Cast y OAuth. Hoy la configuración inspeccionada no produce ese artefacto.
- Resultado real de notarización y cumplimiento de las condiciones de AltStore para la versión enviada. La investigación no los puede sustituir.

No hay un impedimento arquitectónico identificado por usar Capacitor o servidores configurables. La recomendación queda condicionada a esos resultados técnicos y de publicación.

## 8. Vigencia y validación de esta investigación

Se han utilizado fuentes primarias de AltStore, Apple y Capacitor. Entre las fuentes con fecha visible: Apple Support sobre instalación, 18-06-2026; notas PAL hasta 15-06-2026; acuerdo UE revisado 18-08-2026 con efecto 01-10-2026; blog AltStore, 14-10-2026. Las páginas sin fecha se tratan como documentación consultada al corte, no como prueba histórica de una fecha de lanzamiento.

Apple anuncia también cambios futuros ligados a iOS/iPadOS 27.2 en su página UE. No se han considerado disponibles hoy ni se usan para justificar instalación de apps nuevas fuera de la región. No se han usado anuncios posteriores al 21-10-2026 como hechos vigentes.

Validación realizada: contraste documental de territorios, costes, artefactos y requisitos; lectura estática de configuración iOS, workflow y servidor configurable. No se ha compilado, firmado, enviado a revisión ni ejecutado una prueba de dispositivo. El único cambio de este trabajo es este documento.

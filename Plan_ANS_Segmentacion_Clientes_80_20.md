# Plan para el agente: segmentación de clientes mediante aprendizaje no supervisado

## Instrucción principal

Implementa un módulo de **segmentación de clientes por comportamiento de compra** para el SaaS multitienda. Usa **Python** y aprendizaje no supervisado dentro de `IA/ANS`. El modelo partirá de las variables RFM (recencia, frecuencia y monto) y agrupará a los clientes de cada tienda por separado.

La solución debe permitir que el dueño autorizado consulte los grupos desde el área de reportes, con una presentación sencilla y con un modo de demostración que utilice datos simulados claramente identificados. Utiliza una división de **80 % para entrenamiento y 20 % para evaluación**, como se detalla más adelante.

Esta entrega es para una demostración académica local. No requiere GPU, servicios pagados, despliegue ni transacciones reales.

**Conserva todos los cambios existentes. No hagas `git add`, commit, merge, push, reset, clean ni stash. No cambies de rama.** No borres ni sobrescribas claves, archivos `.env`, datos locales, bases remotas, configuraciones de Stripe o procesos existentes. No agregues al repositorio los datasets, modelos, resultados de pruebas ni entornos virtuales generados.

## 1. Revisión inicial obligatoria

Antes de implementar:

1. Comprueba la carpeta de trabajo, la rama y `git status`. Lee las instrucciones del proyecto, incluido `AGENTS.md` si existe, y revisa `contexto.md`.
2. Examina `IA/ANS` para respetar lo que ya exista y `IA/AS` para mantener convenciones compatibles. No reemplaces ni reescribas el módulo supervisado.
3. Revisa el modelo real de tiendas, clientes, sucursales, pedidos, pagos y devoluciones; identifica las fechas y los estados disponibles. No presupongas nombres de tablas o columnas.
4. Identifica cómo se resuelve el tenant, cómo se comprueban los permisos y cómo están implementados los reportes y las traducciones.
5. Determina si existen suficientes datos de ventas para una primera prueba real. Consulta los datos necesarios sin imprimir información personal ni secretos.
6. Documenta los hallazgos que condicionen la implementación. Si falta información histórica o una dependencia impide una prueba, explícalo; no inventes resultados.

Adapta el diseño al código que encuentres. Si hay cambios previos de otras personas o agentes, presérvalos. Mantén la compra, los pagos, el inventario, la PWA, la aplicación móvil y el pronóstico supervisado funcionando.

## 2. Qué debe hacer el modelo

El objetivo es **descubrir grupos de clientes con comportamientos de compra similares**, usando únicamente datos de su tienda.

Construye por cliente un registro con:

| Variable | Significado | Ejemplo ilustrativo |
| --- | --- | --- |
| Recencia | Días desde la última compra válida hasta la fecha de corte | 15 días |
| Frecuencia | Cantidad de pedidos válidos en el periodo de análisis | 4 pedidos |
| Monto | Suma del importe de esas compras, bajo una regla monetaria documentada | Bs 600 |

Los números del ejemplo son inventados y no describen datos del proyecto.

K-Means debe identificar grupos a partir de esas variables. No uses como respuesta previa etiquetas como “cliente frecuente”, “cliente inactivo” o “VIP”. Puedes mostrar descripciones después del entrenamiento siempre que se basen en las características reales del grupo y expliquen lo que se observó. Los identificadores numéricos de los grupos pueden cambiar al reentrenar; no los trates como categorías permanentes.

El sistema **no debe predecir automáticamente** que un cliente dejará de comprar ni ejecutar decisiones, mensajes, descuentos o campañas por pertenecer a un grupo.

## 3. Preparación de datos RFM

Usa una fecha de corte y un periodo de análisis explícitos, configurables y documentados. Un periodo de 12 meses puede servir como valor inicial si encaja con los datos; no lo presentes como requisito universal.

1. Extrae una fila RFM por **cliente y tienda**. Si se agregan compras de distintas sucursales, indica que el análisis es a nivel tienda. Evita duplicar un pedido por tener varias líneas o pagos.
2. Cuenta únicamente pedidos válidos según las reglas reales del sistema. Documenta cómo se tratan los pendientes, cancelados y devueltos. No asegures que el monto es neto de devoluciones si esos datos no se pueden calcular de forma fiable.
3. Usa solo información disponible hasta la fecha de corte. Si no existe historial de cambios de estado, no atribuyas a una fecha pasada el estado actual como si estuviera verificado; documenta la limitación o limita la ejecución a un corte para el cual sea coherente.
4. Calcula la recencia a partir de la última compra válida. Identifica aparte a los clientes sin compras válidas o sin compras en el periodo; no les inventes una fecha y aclara qué condición aplica.
5. No sumes importes expresados en monedas diferentes. Utiliza una moneda coherente y documentada o informa que no es posible combinarlas.
6. Indica la zona horaria y el intervalo de fechas utilizado, de acuerdo con el proyecto. Trata las fechas y los límites del periodo de manera consistente.
7. No uses nombres, correos, teléfonos, contraseñas, tokens, números de tarjetas ni información bancaria como variables de entrenamiento. Usa un identificador técnico separado de las características únicamente cuando sea necesario para asociar resultados autorizados.
8. Maneja explícitamente registros incompletos, fechas inválidas, importes negativos, montos extremos y duplicados. No cambies la información original para hacer que el entrenamiento funcione.

Explica al usuario cuántos clientes fueron elegibles, cuántos quedaron fuera y por qué, sin exponer datos personales en los logs.

## 4. Separación entre tiendas y permisos

- Entrena **un modelo por tienda** y una versión por origen de datos. No mezcles clientes de tiendas distintas durante la extracción, el entrenamiento, la evaluación ni la presentación.
- El backend debe resolver la tienda a partir de la sesión y las reglas existentes. Un identificador recibido del navegador no autoriza por sí solo el acceso a otra tienda.
- Respeta los permisos y roles actuales para consultar reportes y para iniciar entrenamiento. Verifica la autorización también en el backend.
- Separa de forma efectiva datasets temporales, modelos, metadatos y resultados por tenant y por modo real o simulado.
- El servicio o proceso Python debe ser interno y no exponer una operación de entrenamiento sin autenticación. No entregues al frontend acceso directo a modelos de otras tiendas.
- Los resultados deben ser agregados en la primera versión. Si reutilizas una lista existente para consultar clientes de un grupo, aplica los permisos de clientes, el filtro de tenant y los mínimos datos necesarios. No envíes mensajes automáticos.
- No cargues archivos `pickle` o `joblib` suministrados por usuarios o fuentes no confiables, ya que pueden ejecutar código al cargarse.

## 5. Flujo de entrenamiento y evaluación 80/20

En este modelo cada unidad de la división es un **cliente elegible**, no una semana ni un pedido.

1. Para una tienda y una misma fecha de corte, construye la tabla RFM y verifica que cada cliente aparezca una sola vez.
2. Divide los clientes de manera reproducible con una semilla fija:
   - **80 % para entrenamiento**.
   - **20 % para evaluación**.
3. Un cliente no debe aparecer en ambos conjuntos. Documenta cómo redondeas cuando el número de clientes no permite una proporción exacta.
4. Realiza la separación antes de ajustar imputaciones, transformaciones, escalado o modelo. Ajusta todas esas operaciones únicamente con el 80 % y aplícalas después al 20 %. Usa un `Pipeline` de scikit-learn o un mecanismo equivalente.
5. Elige la cantidad de grupos y cualquier parámetro usando únicamente los datos de entrenamiento. Reserva el 20 % para evaluar la solución ya elegida.
6. Aplica el modelo fijo al 20 % para observar su comportamiento en clientes que no se usaron en el entrenamiento. Cuando sea necesario mostrar la distribución de todos los clientes, asigna cada uno usando ese modelo sin volver a ajustarlo con los datos de evaluación.
7. Informa la cantidad total de clientes, los tamaños reales de ambos conjuntos, la semilla y la fecha de corte. Si luego se decide reentrenar con otros datos, identifica el nuevo modelo y no presentes el conjunto reutilizado como una prueba independiente.

**Ejemplo:** con 100 clientes elegibles, 80 se usan para entrenar y 20 para evaluar. Es una división por clientes con la misma fecha de corte. A diferencia del pronóstico de ventas supervisado, este análisis no pretende evaluar directamente el comportamiento de clientes en fechas futuras. Una evaluación temporal posterior requeriría datos y un diseño adicionales.

Como no hay etiquetas correctas, no calcules ni anuncies un supuesto “80 % de precisión”. El 80/20 describe la proporción de datos.

## 6. Algoritmo y métricas

- Comienza con `KMeans` de scikit-learn y semilla fija. Usa un escalado adecuado porque días, pedidos y dinero tienen magnitudes distintas. Si aplicas transformación logarítmica u otro tratamiento para valores extremos, justifícalo y ajústalo solo con entrenamiento.
- Prueba una cantidad razonable de grupos usando únicamente entrenamiento, siempre que haya suficientes clientes y valores distintos. No fuerces un número de grupos cuando los datos no lo respaldan.
- Define un mínimo configurable de datos y de diversidad. Explícalo como criterio de esta implementación, no como una regla universal. Cuando no se cumpla, muestra **“Datos insuficientes”** y evita entrenar.
- Evalúa la cohesión y separación de los grupos con métricas apropiadas. Puedes usar **silhouette** cuando existan al menos dos grupos distintos y suficientes clientes para calcularla. Si no cumple las condiciones, informa “no disponible”.
- Reporta por separado las métricas de entrenamiento y evaluación cuando se puedan calcular, la cantidad de clientes en cada grupo y un resumen interpretable de las tres variables en sus unidades originales.
- Indica que la separación matemática de los grupos es orientativa: no demuestra por sí sola que los grupos sean útiles comercialmente ni garantiza comportamiento futuro.
- No inventes porcentajes de confianza, probabilidades o resultados. En casos de clusters vacíos, un solo grupo en evaluación o poca variedad, maneja el estado con un mensaje claro.
- Documenta dependencias y versiones compatibles de Python, pandas, NumPy y scikit-learn. La ejecución debe ser reproducible en la PC, sin GPU.

## 7. Datos reales y datos simulados

Implementa dos modos separados:

### Datos reales

Extrae en modo lectura las compras de la tienda autorizada mediante el mecanismo del backend o repositorio ya existente. Entrena solo si existen suficientes clientes y calidad de datos. Las tiendas nuevas pueden mostrar “Datos insuficientes”.

### Datos simulados

Crea un generador reproducible con semilla fija que produzca al menos dos tiendas ficticias con clientes y compras variadas. Genera suficiente volumen y diversidad para mostrar varios comportamientos y ejecutar la división 80/20. Puedes usar, por ejemplo, 100 o más clientes ficticios elegibles por tienda; es una cifra para la demo, no una condición universal para datos reales.

Guarda estos datos en archivos o en una base de pruebas aislada. No escribas, borres ni alteres registros de la base de demostración existente. No mezcles una tienda real con clientes ficticios. Si conectas los resultados simulados a la web, utiliza un modo explícito asociado a la sesión autorizada, aislado y con la leyenda **“Datos de demostración”**.

No llames a Stripe ni generes pagos. Una buena puntuación con datos simulados demuestra el recorrido técnico, no la calidad de los grupos sobre clientes reales.

## 8. Integración con el sistema

1. Elige el mecanismo de integración interna más sencillo compatible con el proyecto: un proceso Python controlado, una tarea interna u otro patrón ya existente. Documenta cómo se inicia y cómo informa errores.
2. El entrenamiento debe iniciarse mediante una acción autorizada o un proceso controlado; no se debe repetir por cada visita a la página. Evita entrenamientos simultáneos duplicados para una tienda.
3. Conserva el estado por tienda y origen, por ejemplo: `sin datos suficientes`, `entrenando`, `listo` y `error`. Maneja interrupciones y errores sin marcar como listo un modelo incompleto.
4. Integra en **Reportes** una sección “Segmentación de clientes” o un nombre equivalente coherente con el diseño actual.
5. Muestra la fecha de corte, el periodo, el origen real o simulado, la cantidad de clientes analizados y cada grupo con su descripción y cantidad. Muestra valores RFM representativos en unidades entendibles.
6. Usa textos breves y neutrales. Puedes añadir una opción “¿Cómo se calcula?” con detalles, sin llenar la pantalla principal de advertencias técnicas.
7. Traduce todos los textos nuevos a español, inglés, francés y chino, siguiendo las convenciones del proyecto.
8. Guarda modelo, escalador y metadatos de forma coherente y separada por tienda, sin añadirlos a Git. Muestra cuándo se entrenó el modelo y evita indicar que se actualiza automáticamente si no está implementado.
9. Esta entrega se consulta con conexión. No implementes sincronización offline ni cambios en la aplicación móvil para este módulo.

## 9. Pruebas y criterios de aceptación

Ejecuta pruebas útiles en un entorno aislado y reporta resultados reales:

- **RFM:** cálculo de las tres variables, límite de fechas y moneda; pedidos duplicados, cancelados y devueltos; clientes sin compras, datos faltantes y valores extremos.
- **80/20:** proporciones y redondeo, semilla reproducible, cliente único en una sola partición, y escalador ajustado solo con el entrenamiento.
- **Clustering:** cantidades de grupos válidas, datos insuficientes, filas idénticas, resultado reproducible y métricas no disponibles cuando no se cumplan sus condiciones.
- **Seguridad:** una tienda no puede consultar ni entrenar sobre datos, modelos o resultados de otra, incluso si manipula identificadores; verificar permisos tanto en la API como en el acceso a archivos.
- **Integración:** estados de entrenamiento, dos solicitudes simultáneas, mensajes de error, separación real/simulado y traducciones.
- **Regresión:** ejecuta las pruebas pertinentes y comprueba que el pronóstico supervisado, los reportes existentes y las funcionalidades tocadas siguen funcionando.
- **Recorrido de demostración:** generar datos → construir RFM → dividir por cliente → entrenar → evaluar → consultar los grupos en la web.

La entrega estará completa cuando el recorrido esté probado, la demo esté identificada, se respeten la división 80/20 y el aislamiento entre tiendas y exista documentación para repetirlo. Si una parte no puede ejecutarse, explica el bloqueo sin declararla completada.

## 10. Guía de ejecución para Windows

Crea o actualiza `IA/ANS/README.md` con comandos **reales, completos y probados en Windows PowerShell**, que correspondan a los archivos y scripts implementados:

1. Ir a `IA/ANS`, comprobar la versión de Python, crear un entorno virtual e instalar dependencias.
2. Generar datos simulados aislados y consultar la ubicación de salida.
3. Preparar RFM y entrenar el modelo de una tienda con la división 80/20.
4. Ver la cantidad de clientes en entrenamiento y evaluación, la semilla, los grupos y las métricas disponibles.
5. Iniciar los componentes necesarios y abrir la sección de reportes en la web.
6. Entrenar posteriormente con datos reales de una tienda, solo si tiene historial suficiente y sin mezclarlos con la demo.
7. Borrar exclusivamente los archivos de simulación creados por esta función mediante una acción explícita y segura.

Si PowerShell no permite activar el entorno virtual, incluye la alternativa de ejecutar directamente el Python de ese entorno. No inventes comandos ni rutas y no solicites que se compartan claves.

## 11. Informe final del agente

Explica en español:

- Cómo funciona el módulo y qué datos utiliza.
- Cómo se calculan RFM, los grupos y la separación por tienda.
- Cantidad real de clientes de entrenamiento y evaluación; grupos y métricas obtenidos, indicando si los datos son simulados.
- Dónde se consulta el resultado, quién tiene acceso y cómo volver a ejecutar el entrenamiento.
- Qué pruebas pasaron, qué quedó pendiente y cuáles son las limitaciones.
- Archivos modificados, estado de Git y confirmación de que no hiciste commit.

Si identificas problemas anteriores al trabajo, repórtalos sin corregirlos fuera de alcance.

## Referencias oficiales

- [K-Means — scikit-learn](https://scikit-learn.org/stable/modules/generated/sklearn.cluster.KMeans.html)
- [Ejemplo de selección de grupos con silhouette — scikit-learn](https://scikit-learn.org/stable/auto_examples/cluster/plot_kmeans_silhouette_analysis.html)
- [Condiciones de la métrica silhouette — scikit-learn](https://scikit-learn.org/stable/modules/generated/sklearn.metrics.silhouette_score.html)
- [Prevención de fuga de datos — scikit-learn](https://scikit-learn.org/stable/common_pitfalls.html#data-leakage)
- [Persistencia y seguridad de modelos — scikit-learn](https://scikit-learn.org/stable/model_persistence.html)


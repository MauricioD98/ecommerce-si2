# Plan para el agente: pronóstico de ventas supervisado

## Instrucción principal

Implementa en este proyecto un primer módulo de **aprendizaje supervisado en Python** que estime cuántas unidades se venderán en la próxima semana completa, por tienda, sucursal y producto o variante, según lo que permita el modelo de datos existente. El resultado debe poder consultarse desde el área de reportes de la tienda.

El código de aprendizaje supervisado va en `IA/AS`. `IA/ANS` está reservado para aprendizaje no supervisado: no implementes nada allí. Mantén la arquitectura actual de la aplicación y la separación entre tiendas. Trabaja para una demostración local de un proyecto académico: no se necesitan servicios pagos, GPU ni despliegues.

**No hagas `git add`, commit, merge, push, reset, clean ni stash.** No cambies de rama por tu cuenta. Conserva los cambios existentes, incluidos los archivos sin seguimiento. No toques ni sobrescribas `.env`, claves, bases remotas, configuraciones de Stripe, datos locales ni procesos existentes sin verificar primero su propósito. No uses claves live. No subas datasets ni modelos generados al repositorio.

## 1. Revisión inicial obligatoria

Antes de cambiar código:

1. Comprueba la carpeta, rama, `git status` y las instrucciones del proyecto, incluido `AGENTS.md` si existe. Lee `contexto.md` y examina `IA/AS` para no duplicar trabajo.
2. Revisa cómo funcionan las tiendas, la resolución del tenant, la autorización, las sucursales, los productos, las variantes/tallas, las ventas, las devoluciones, el inventario y el área de reportes. Verifica los nombres y estados reales en el código y en el esquema de datos; no presupongas tablas ni relaciones.
3. Identifica cómo obtener historial de ventas de una sola tienda sin acceder a las demás y qué registros representan ventas válidas. Comprueba cómo contabilizar cancelaciones y devoluciones.
4. Identifica los datos disponibles y sus fechas. Si no existe historial de estado, precio, stock o promociones por fecha, indícalo y no simules que existe. Consulta datos existentes solo de forma segura y sin imprimir información privada.
5. Explica brevemente qué encontraste y adapta el diseño a las convenciones reales. Si una dependencia, el estado del proyecto o los datos impiden completar alguna parte, comunica el bloqueo con evidencia; no inventes resultados.

## 2. Objetivo que aprenderá el modelo

La **variable a predecir** es la cantidad de unidades de un producto o variante efectivamente vendidas en una sucursal durante una semana completa posterior a la fecha de corte. Se trata de ventas observadas; no prometas estimar la demanda que se habría producido si hubiera existido más stock.

- Usa periodos semanales coherentes y no superpuestos; por ejemplo, de lunes a domingo. Muestra en pantalla el periodo pronosticado y la fecha de corte de la información.
- Una fila de entrenamiento representa, cuando el proyecto lo permita, una combinación de tienda, sucursal, producto/variante y semana objetivo.
- La respuesta correcta o **etiqueta** es la cantidad vendida en esa semana. Las características solo pueden utilizar información que ya estaba disponible al momento de generar ese pronóstico.
- Propón como variables las ventas de las últimas 1, 2 y 4 semanas, la categoría y el calendario. Utiliza precio, promociones o disponibilidad histórica únicamente si existe información fiable de ese momento. No uses datos de ventas futuras ni el stock actual como si fueran stock histórico.
- Define cómo tratar los registros cancelados y las devoluciones con base en el funcionamiento real de la aplicación. Documenta las reglas para poder repetir el cálculo.
- Distingue una semana realmente observada sin ventas de una semana sin información suficiente. No conviertas automáticamente los periodos desconocidos en cero. Si hubo falta de inventario conocida, informa la limitación y evita presentar las ventas observadas como demanda total.
- Nunca incluyas contraseñas, tokens, datos bancarios, números de tarjetas ni datos personales innecesarios en el dataset o en los logs.

Ejemplo didáctico: a partir de las ventas de semanas anteriores, el modelo estima **7 unidades para la próxima semana**. Esa cifra es ilustrativa, no es un resultado medido del proyecto.

## 3. Datos: reales y simulados

Implementa dos orígenes claramente separados:

1. **Datos reales del proyecto:** extracción de solo lectura de las ventas de la tienda autorizada, usando el mecanismo real de aislamiento y autorización del backend. Revisa el historial disponible antes de intentar entrenar. Una tienda nueva debe mostrar `datos insuficientes` cuando no tenga el mínimo definido y documentado.
2. **Datos simulados para presentación:** generador reproducible, con semilla fija, sin datos personales y con al menos dos tiendas ficticias, varias sucursales y productos, y suficiente historia para formar al menos 100 semanas objetivo válidas después de calcular las variables históricas. Las simulaciones deben ser plausibles, pero no se deben presentar como datos reales ni como evidencia de precisión real.

Guarda la simulación en archivos o en una base aislada y temporal, según convenga al proyecto. No agregues ni modifiques automáticamente ventas en la base local existente. No combines silenciosamente datos reales y simulados. Si conectas la simulación a la pantalla, hazlo como modo de demostración explícito y visible, aislado por tienda, sin contaminar los reportes existentes. No conectes el generador a Stripe.

Cada modelo se entrena con datos de **una sola tienda**. Puedes reunir las series de sus distintos productos y sucursales para entrenar un modelo de esa tienda si esto mejora la disponibilidad de datos. No entrenes un modelo compartido con información de diferentes tiendas sin autorización explícita y un diseño separado. Los productos nuevos o con historial escaso deben mostrar una estimación alternativa claramente identificada o un mensaje de datos insuficientes; no atribuyas esa alternativa al modelo entrenado.

## 4. División de entrenamiento y prueba: 80/20

La división debe ser **cronológica**, porque se está pronosticando el futuro:

1. Ordena las semanas objetivo completas y elegibles por fecha.
2. Reserva las primeras **80 % de las semanas** para entrenamiento y las últimas **20 %** para prueba final. Calcula y documenta el redondeo si la cantidad de semanas no permite una proporción exacta.
3. Mantén todas las filas de una misma semana del mismo lado de la división, aunque correspondan a distintos productos o sucursales. Informa el número de semanas y de filas de cada conjunto: el porcentaje de filas puede diferir del porcentaje de semanas.
4. Una etiqueta de entrenamiento debe estar completamente disponible antes del primer corte de predicción del conjunto de prueba. Si la construcción de ventanas hace que los periodos se solapen, introduce la separación necesaria y documéntala.
5. Ajusta el preprocesamiento, la selección de características y el modelo **solo con entrenamiento**. Usa un `Pipeline` de scikit-learn o un mecanismo equivalente para evitar que los datos de prueba influyan en el ajuste.
6. Si es necesario ajustar parámetros, usa validación cronológica dentro del 80 % de entrenamiento. Reserva el 20 % final para la evaluación final; no lo uses para elegir repetidamente la configuración del modelo.
7. Reporta las fechas, cantidades, origen de datos, semilla, versión del modelo y resultados. No describas la división 80/20 como un porcentaje de precisión.

Ejemplo: si después de preparar los datos quedan **100 semanas objetivo completas**, se usan las primeras 80 semanas para entrenamiento y las últimas 20 para evaluación. Las semanas anteriores que se necesiten para construir ventas históricas no forman por sí solas etiquetas de entrenamiento.

Cuando evalúes varias semanas, los datos de semanas de prueba anteriores pueden utilizarse como historial de una predicción posterior solo si para ese momento ya habrían sido observados. Especifica si el modelo permanece fijo o si se reentrena y aplica la misma regla al método de comparación.

## 5. Entrenamiento y evaluación

- Usa Python y bibliotecas adecuadas al proyecto, por ejemplo `pandas`, `scikit-learn` y una forma segura de persistir el modelo. Documenta y fija versiones compatibles.
- Implementa una primera regresión supervisada reproducible, por ejemplo `RandomForestRegressor` con semilla fija. Considera su utilidad y simplicidad frente a los datos realmente disponibles.
- Compara el modelo contra una **línea base simple** disponible con la misma información, por ejemplo ventas de la semana anterior o promedio de las últimas cuatro semanas.
- Calcula al menos el **error absoluto medio (MAE)** para ambos sobre el mismo conjunto de prueba. Si muestras otra métrica, explica qué significa y cómo se trata una división por cero. No inventes porcentajes de precisión ni prometas que el modelo supera la línea base.
- El informe debe incluir volumen y fechas de los datos, número de series, MAE del modelo y de la línea base, y limitaciones. Si los datos son insuficientes o el modelo no supera la línea base, muéstralo con honestidad.
- No uses el conjunto de prueba para recalcular el preprocesamiento. El manejo de categorías o productos desconocidos debe ser explícito.
- Mantén predicciones en unidades no negativas; conserva los decimales necesarios para evaluar y explica cómo se redondean para mostrarlas.
- Separa artefactos y resultados por tienda. Registra origen, corte, versión y fecha de entrenamiento. No cargues modelos `pickle`/`joblib` procedentes de usuarios o fuentes no confiables. Los archivos generados, entornos virtuales y datos no deben añadirse a Git.

## 6. Integración con el sistema

Integra la predicción con el backend y la interfaz existentes, sin alterar la compra, los pagos, la PWA ni el funcionamiento offline:

1. El backend debe verificar la sesión, los permisos y la tienda mediante las reglas actuales del proyecto. La identidad del tenant no debe depender de un identificador arbitrario enviado por el navegador.
2. Python debe ejecutarse como componente local/interno. Elige la integración más simple compatible con el proyecto: proceso de trabajo, comando controlado u otro mecanismo existente. Si usas una API separada, mantenla interna y autenticada; no expongas públicamente una operación de entrenamiento.
3. No entrenes un modelo en cada visita de página. Usa una acción autorizada o un proceso controlado para iniciarlo y guarda su estado. Evita ejecuciones simultáneas duplicadas por tienda.
4. En el área de **Reportes**, muestra una sección de pronóstico con la sucursal, producto o variante, periodo estimado, unidades previstas, fecha de corte, origen real/simulado y estado. Añade vistas claras para `sin datos suficientes`, `entrenando`, `listo` y `error` según el flujo implementado.
5. Respeta los idiomas existentes: español, inglés, francés y chino. No presentes una confianza o probabilidad que no haya sido calculada y validada.
6. Si decides mostrar una comparación con inventario, consulta el stock disponible actual con las reglas ya existentes y presenta la diferencia como orientativa, sin modificar existencias, reservas ni pedidos. Si ese dato no es fiable, omite esa comparación.
7. La aplicación móvil y las carpetas de aprendizaje no supervisado no necesitan cambios para esta primera entrega. El pronóstico se obtiene con conexión; no prometas ejecución offline en el teléfono.

## 7. Pruebas y criterios de aceptación

Ejecuta pruebas útiles en un entorno aislado y reporta exactamente qué pasó:

- Preparación del dataset: fechas, cantidades, estados válidos, cancelaciones/devoluciones, semanas sin ventas y ausencia de historial.
- Corte temporal: semanas completas agrupadas, división 80/20, ausencia de información futura y preprocesamiento ajustado solo al entrenamiento.
- Modelo y línea base: mismo conjunto final de prueba, resultados reproducibles, MAE calculado correctamente, series nuevas o insuficientes y categorías desconocidas.
- Aislamiento: una tienda no puede consultar modelos, archivos ni predicciones de otra aunque intente cambiar identificadores; los datos simulados tampoco se mezclan entre tiendas.
- Backend e interfaz: permisos, estados, fechas, origen simulado/real y mensajes en cuatro idiomas. Comprueba también la compilación y las pruebas pertinentes existentes sin usar Stripe real.
- Ejecuta al menos un recorrido completo con datos simulados aislados: generar datos, construir el dataset, entrenar, evaluar y consultar la predicción desde la aplicación. Si alguna parte no puede verificarse, explica el motivo en vez de declarar que está completa.

La entrega está completa cuando el recorrido funciona, los datos simulados están identificados, se respeta el 80/20 temporal, el aislamiento está probado y existe documentación reproducible. Una buena métrica sobre datos simulados solo demuestra el flujo; no demuestra calidad con ventas reales.

## 8. Guía que debes entregar al usuario

Crea o actualiza `IA/AS/README.md` con comandos **reales, completos y probados para Windows PowerShell**, acordes con los scripts que hayas creado, para:

1. Ubicarse en `IA/AS`, comprobar Python, crear un entorno virtual e instalar dependencias.
2. Generar datos simulados en una ubicación aislada y reconocer que se trata de una demo.
3. Preparar el dataset e iniciar un entrenamiento por tienda con la división cronológica 80/20.
4. Consultar el periodo, número de filas y semanas, las métricas frente a la línea base y el lugar donde se guardó el modelo.
5. Iniciar los componentes estrictamente necesarios y abrir la sección correspondiente en la web.
6. Entrenar más adelante con datos reales **solo cuando haya historial suficiente**, con aislamiento de tienda y sin mezclarlo con la demo.
7. Repetir o eliminar únicamente los datos simulados generados por esta función de manera explícita y segura.

Si la activación del entorno virtual está restringida en PowerShell, documenta también cómo ejecutar el Python del entorno virtual por su ruta directa. No incluyas comandos para scripts o endpoints que no existan. No pidas al usuario compartir claves ni vuelques secretos en la consola.

## 9. Informe final del agente

Explica en español: cómo quedó conectado el módulo, qué datos y permisos usa, el alcance real, cómo ejecutarlo, cómo leer MAE, las fechas/cantidades del corte 80/20, resultados del modelo y de la línea base, pruebas ejecutadas, limitaciones, cambios de archivos y estado final de Git. Distingue de forma visible los datos simulados de los reales. Si encuentras problemas anteriores, infórmalos sin modificarlos fuera de alcance. Confirma que no hiciste commit ni alteraste `IA/ANS`.

## Referencias oficiales

- [Validación cruzada para datos temporales — scikit-learn](https://scikit-learn.org/stable/modules/cross_validation.html#cross-validation-of-time-series-data)
- [Riesgos de fuga de información en preprocesamiento — scikit-learn](https://scikit-learn.org/stable/common_pitfalls.html#data-leakage)
- [Regresión Random Forest — scikit-learn](https://scikit-learn.org/stable/modules/generated/sklearn.ensemble.RandomForestRegressor.html)
- [Persistencia y seguridad de modelos — scikit-learn](https://scikit-learn.org/stable/model_persistence.html)

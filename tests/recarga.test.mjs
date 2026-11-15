import { test } from "node:test";
import assert from "node:assert/strict";

// El reloj controlado permite distinguir el fin del gesto de la inercia sin
// pausas reales ni depender de la frecuencia del monitor.
globalThis.JSWindowActorChild = class {
  mensajes = [];
  sendAsyncMessage(nombre, datos) { this.mensajes.push({ nombre, datos }); }
};
const { BookosRecargaChild } = await import("../bookos/BookosRecargaChild.sys.mjs");
globalThis.JSWindowActorParent = class {};
const { BookosRecargaParent } = await import("../bookos/BookosRecargaParent.sys.mjs");

function preparar() {
  let ahora = 0;
  let id = 0;
  const tareas = new Map();
  const programar = (funcion, demora) => {
    tareas.set(++id, { funcion, cuando: ahora + demora });
    return id;
  };
  const raiz = { nodeType: 1, matches: () => false, scrollHeight: 2000, clientHeight: 600 };
  const actor = new BookosRecargaChild();
  actor.document = { scrollingElement: raiz, fullscreenElement: null };
  actor.contentWindow = {
    scrollY: 0, innerHeight: 600,
    performance: { now: () => ahora },
    getComputedStyle: nodo => ({ overflowY: "visible", overscrollBehaviorY: "auto", ...nodo.estilo }),
    setTimeout: programar, clearTimeout: clave => tareas.delete(clave),
    requestAnimationFrame: funcion => programar(funcion, 16),
    cancelAnimationFrame: clave => tareas.delete(clave),
  };
  const avanzar = ms => {
    const hasta = ahora + ms;
    while (true) {
      const siguiente = [...tareas].filter(([, t]) => t.cuando <= hasta).sort((a, b) => a[1].cuando - b[1].cuando)[0];
      if (!siguiente) break;
      const [clave, tarea] = siguiente;
      tareas.delete(clave);
      ahora = tarea.cuando;
      tarea.funcion(ahora);
    }
    ahora = hasta;
  };
  const evento = (tipo, valores = {}) => {
    const ev = {
      type: tipo, isTrusted: true, deltaX: 0, deltaY: 0, deltaMode: 0, defaultPrevented: false,
      composedPath: () => [raiz],
      preventDefault() { this.defaultPrevented = true; },
      ...valores,
    };
    actor.handleEvent(ev);
    return ev;
  };
  const rueda = (dy, valores) => evento("wheel", { deltaY: dy, ...valores });
  const arrastrar = () => { for (let n = 0; n < 8; n++) { rueda(-60); avanzar(20); } };
  const confirmar = () => actor.mensajes.some(m => m.nombre === "soltar" && m.datos);
  return { actor, avanzar, evento, rueda, arrastrar, confirmar, raiz };
}

test("solo confirma al soltar después de alcanzar el umbral", () => {
  const p = preparar();
  p.arrastrar();
  assert.equal(p.confirmar(), false);
  assert.equal(p.actor.mensajes.at(-1).datos.progreso, 1);
  p.avanzar(201);
  assert.equal(p.confirmar(), true);
});

test("un arrastre corto vuelve sin recargar", () => {
  const p = preparar();
  p.rueda(-45);
  p.avanzar(201);
  assert.deepEqual(p.actor.mensajes.at(-1), { nombre: "soltar", datos: false });
});

test("subir desde media página y seguir tirando en el borde recarga", () => {
  const p = preparar();
  p.actor.contentWindow.scrollY = 200;
  p.rueda(-60);
  p.avanzar(20);
  p.actor.contentWindow.scrollY = 0;
  p.arrastrar();
  p.avanzar(201);
  assert.equal(p.confirmar(), true);
});

test("el recorrido hasta el borde no cuenta para el umbral", () => {
  const p = preparar();
  p.actor.contentWindow.scrollY = 200;
  for (let n = 0; n < 10; n++) { p.rueda(-60); p.avanzar(20); }
  p.actor.contentWindow.scrollY = 0;
  p.rueda(-60);
  p.avanzar(201);
  assert.equal(p.confirmar(), false);
});

test("bajar y volver a subir sin levantar los dedos recarga en el borde", () => {
  const p = preparar();
  p.rueda(60);
  p.avanzar(10);
  p.actor.contentWindow.scrollY = 200;
  p.rueda(-60);
  p.avanzar(10);
  p.actor.contentWindow.scrollY = 0;
  p.arrastrar();
  p.avanzar(201);
  assert.equal(p.confirmar(), true);
});

test("bajar por la página sin volver a subir no recarga", () => {
  const p = preparar();
  for (let n = 0; n < 10; n++) { p.rueda(60); p.avanzar(10); }
  p.avanzar(201);
  assert.equal(p.actor.mensajes.length, 0);
});

test("el gesto horizontal no se convierte después en una recarga", () => {
  const p = preparar();
  p.rueda(-2, { deltaX: 20 });
  p.arrastrar();
  p.avanzar(201);
  assert.equal(p.actor.mensajes.length, 0);
});

test("la rueda de ratón por líneas y el zoom conservan su función", () => {
  for (const valores of [{ deltaMode: 1 }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }]) {
    const p = preparar();
    assert.equal(p.rueda(-180, valores).defaultPrevented, false);
    p.avanzar(201);
    assert.equal(p.actor.mensajes.length, 0);
  }
});

test("respeta campos editables, paneles y overscroll controlado por la web", () => {
  for (const nodo of [
    { matches: () => true },
    { isContentEditable: true },
    { scrollHeight: 500, clientHeight: 100, estilo: { overflowY: "auto" } },
    { estilo: { overscrollBehaviorY: "contain" } },
  ]) {
    const p = preparar();
    p.rueda(-180, { composedPath: () => [{ nodeType: 1, matches: () => false, ...nodo }, p.raiz] });
    p.avanzar(201);
    assert.equal(p.actor.mensajes.length, 0);
  }
});

test("respeta eventos consumidos por la página y los no fiables", () => {
  for (const valores of [{ defaultPrevented: true }, { isTrusted: false }]) {
    const p = preparar();
    p.rueda(-180, valores);
    p.avanzar(201);
    assert.equal(p.actor.mensajes.length, 0);
  }
});

test("invertir el arrastre desarma la recarga sin acumular exceso", () => {
  const p = preparar();
  for (let n = 0; n < 20; n++) { p.rueda(-50); p.avanzar(20); }
  p.rueda(90);
  p.avanzar(201);
  assert.equal(p.confirmar(), false);
  assert.deepEqual(p.actor.mensajes.at(-1), { nombre: "soltar", datos: false });
});

test("Escape cancela el gesto sin recargar", () => {
  const p = preparar();
  p.arrastrar();
  p.evento("keydown", { key: "Escape" });
  p.arrastrar();
  p.avanzar(201);
  assert.equal(p.confirmar(), false);
  assert.equal(p.actor.mensajes.at(-1).nombre, "cancelar");
});

test("ignora la cola de inercia después de completar", () => {
  const p = preparar();
  p.arrastrar();
  p.avanzar(201);
  const cantidad = p.actor.mensajes.length;
  p.arrastrar();
  p.avanzar(201);
  assert.equal(p.actor.mensajes.length, cantidad);
});

test("un fin explícito conserva el umbral aunque llegue antes de pintar", () => {
  const p = preparar();
  p.rueda(-480);
  p.rueda(0);
  assert.deepEqual(p.actor.mensajes.slice(-2).map(m => m.nombre), ["progreso", "soltar"]);
  assert.equal(p.confirmar(), true);
});

test("un dedo arrastra y soltar confirma; un segundo dedo cancela", () => {
  for (const cancelar of [false, true]) {
    const p = preparar();
    p.evento("touchstart", { touches: [{ clientX: 200, clientY: 100 }] });
    p.evento("touchmove", { touches: [{ clientX: 200, clientY: 600 }] });
    p.avanzar(20);
    if (cancelar) p.evento("touchstart", { touches: [{ clientX: 200, clientY: 600 }, { clientX: 250, clientY: 600 }] });
    p.evento("touchend", { touches: [] });
    assert.equal(p.confirmar(), !cancelar);
  }
});

test("el padre entrega el gesto a la ventana de la pestaña activa", () => {
  const recibidos = [];
  const win = { bookosRecarga: {
    actualizar: (_actor, datos) => recibidos.push(datos),
    soltar: (_actor, datos) => recibidos.push(datos),
    cancelar: () => recibidos.push("cancelar"),
  } };
  const browser = { ownerDocument: { defaultView: win } };
  win.gBrowser = { selectedBrowser: browser };
  const padre = new BookosRecargaParent();
  padre.manager = {};
  padre.browsingContext = { top: { embedderElement: browser }, currentWindowGlobal: padre.manager };
  padre.receiveMessage({ name: "progreso", data: { progreso: 1 } });
  padre.receiveMessage({ name: "soltar", data: true });
  padre.receiveMessage({ name: "cancelar" });
  assert.deepEqual(recibidos, [{ progreso: 1 }, true, "cancelar"]);
  win.gBrowser.selectedBrowser = {};
  padre.receiveMessage({ name: "soltar", data: true });
  assert.equal(recibidos.length, 3);
  win.gBrowser.selectedBrowser = browser;
  padre.browsingContext.currentWindowGlobal = {};
  padre.receiveMessage({ name: "soltar", data: true });
  assert.equal(recibidos.length, 3);
});

test("un deslizamiento normal al llegar arriba no arma la recarga", () => {
  const p = preparar();
  for (let n = 0; n < 5; n++) { p.rueda(-60); p.avanzar(20); }
  p.avanzar(201);
  assert.deepEqual(p.actor.mensajes.at(-1), { nombre: "soltar", datos: false });
});

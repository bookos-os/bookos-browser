// Se puede llegar al borde en mitad del gesto y seguir tirando, como en iOS:
// la inercia del touchpad la hace APZ sin eventos wheel, así que lo que llega
// aquí son dedos sobre el touchpad. El umbral, con su resistencia, exige un
// arrastre deliberado, no un toque.
// En px de rueda ya amortiguados (ver la resistencia en #mover): hacen falta
// ~310px de dedo. Medido en el touchpad real (traza en bookos.es): llegan
// deltas de 1,3–4px cada 7 ms y no dependen del alto de la ventana. Con 150
// sin resistencia se armaba al rozar; con el 40 % de la ventana (~650px)
// no se llegaba nunca.
const UMBRAL = 200;
const PAUSA = 200;

export class BookosRecargaChild extends JSWindowActorChild {
  #estado = "reposo";
  #origen = null;
  #x = 0;
  #y = 0;
  #distancia = 0;
  #ultimoToque = null;
  #fin = 0;
  #fotograma = 0;
  #bloqueadoHasta = 0;
  #bajando = false;

  // «borde»: todo vale salvo que aún no está arriba; se espera a llegar.
  #puedeEmpezar(ev) {
    const win = this.contentWindow;
    const doc = this.document;
    if (doc.fullscreenElement || ev.defaultPrevented) return false;
    for (const nodo of ev.composedPath()) {
      if (nodo.nodeType !== 1) continue;
      if (nodo.matches("input, textarea, select") || nodo.isContentEditable) return false;
      const estilo = win.getComputedStyle(nodo);
      if (estilo.overscrollBehaviorY !== "auto") return false;
      if (nodo !== doc.scrollingElement &&
          nodo.scrollHeight > nodo.clientHeight + 1 && /auto|scroll/.test(estilo.overflowY)) return false;
    }
    return win.scrollY > 0.5 ? "borde" : true;
  }

  #estadoInicial(ev) {
    const puede = this.#puedeEmpezar(ev);
    return puede === "borde" ? "borde" : puede ? "posible" : "descartado";
  }

  handleEvent(ev) {
    const win = this.contentWindow;
    if (ev.type === "pageshow") {
      // El grupo de sistema ve primero si la web consumió el evento, incluso
      // cuando lo hace en un listener de window registrado después del nuestro.
      for (const tipo of ["wheel", "touchstart", "touchmove", "touchend", "touchcancel", "keydown"]) {
        win.addEventListener(tipo, this, { passive: !["wheel", "touchmove"].includes(tipo), mozSystemGroup: true });
      }
      return;
    }
    if (ev.type === "pagehide") {
      this.#cancelar();
      for (const tipo of ["wheel", "touchstart", "touchmove", "touchend", "touchcancel", "keydown"]) {
        win.removeEventListener(tipo, this, { mozSystemGroup: true });
      }
      return;
    }
    if (!ev.isTrusted) return;
    if (ev.type === "keydown") {
      if (ev.key === "Escape") {
        this.#cancelar();
        this.#bloqueadoHasta = win.performance.now() + 450;
      }
      return;
    }
    if (ev.type === "touchcancel") {
      this.#cancelar();
      return;
    }
    if (ev.type === "touchend") {
      if (this.#origen === "tacto") this.#soltar();
      return;
    }
    if (ev.type === "touchstart") {
      this.#cancelar();
      this.#origen = "tacto";
      this.#estado = ev.touches.length === 1 && win.performance.now() >= this.#bloqueadoHasta ? this.#estadoInicial(ev) : "descartado";
      this.#ultimoToque = ev.touches.length === 1 ? { x: ev.touches[0].clientX, y: ev.touches[0].clientY } : null;
      return;
    }
    if (ev.type === "touchmove") {
      if (ev.touches.length !== 1 || !this.#ultimoToque) {
        this.#cancelar();
        return;
      }
      const toque = ev.touches[0];
      const dx = toque.clientX - this.#ultimoToque.x;
      const dy = toque.clientY - this.#ultimoToque.y;
      this.#ultimoToque = { x: toque.clientX, y: toque.clientY };
      this.#mover(dx, dy, ev);
      return;
    }
    if (ev.deltaMode !== 0 || ev.ctrlKey || ev.metaKey || ev.altKey || ev.shiftKey) {
      this.#cancelar();
      this.#bloqueadoHasta = win.performance.now() + 450;
      return;
    }
    if (this.#origen === "tacto") return;
    if (win.performance.now() < this.#bloqueadoHasta) return;
    if (this.#estado === "reposo") {
      this.#origen = "rueda";
      this.#estado = ev.deltaY < 0 ? this.#estadoInicial(ev) : "descartado";
    } else if (this.#estado === "descartado" && this.#bajando && ev.deltaY < 0) {
      // El compositor no avisa al levantar los dedos y bajar y volver a
      // subir llega como un único gesto (traza real: ~200 eventos seguidos,
      // uno cada 7 ms, sin pausa): sin esto, haber empezado bajando
      // descartaba también el tirón final en el borde.
      this.#x = this.#y = 0;
      this.#estado = this.#estadoInicial(ev);
    }
    if (ev.deltaY) this.#bajando = ev.deltaY > 0;
    win.clearTimeout(this.#fin);
    if (!ev.deltaX && !ev.deltaY) {
      this.#soltar();
      return;
    }
    this.#fin = win.setTimeout(() => this.#soltar(), PAUSA);
    this.#mover(ev.deltaX, -ev.deltaY, ev);
  }

  #mover(dx, dy, ev) {
    if (this.#estado === "descartado" || this.#estado === "reposo") return;
    if (this.#estado === "borde") {
      // Bajar por la página o un gesto lateral cierran la espera; el
      // recorrido hasta el borde no cuenta para el umbral.
      if (dy < 0 || Math.abs(dx) > Math.abs(dy) * 1.5) this.#estado = "descartado";
      else if (this.contentWindow.scrollY <= 0.5 && !ev.defaultPrevented) {
        this.#estado = "posible";
        this.#x = this.#y = 0;
      }
      return;
    }
    if (ev.defaultPrevented || this.contentWindow.scrollY > 0.5) {
      this.#cancelar();
      this.#estado = "descartado";
      return;
    }
    this.#x += dx;
    this.#y += dy;
    if (this.#estado === "posible") {
      // Dos dedos en un touchpad nunca bajan rectos: exigir el doble de
      // vertical que de horizontal dejaba fuera muchos gestos reales, que
      // se quedaban en «posible» y parecía que no pillaba los dedos.
      if (this.#y < -8 || Math.abs(this.#x) >= 16 && Math.abs(this.#x) > Math.abs(this.#y) * 1.5) {
        this.#estado = "descartado";
        return;
      }
      if (this.#y < 10 || this.#y < Math.abs(this.#x)) return;
      this.#estado = "arrastrando";
      this.#distancia = this.#y - dy;
    }
    ev.preventDefault();
        // Resistencia de goma al tirar: cuanto más lejos, menos avanza, como el
    // borde elástico de iOS. Se integra en tramos de 10px para que un evento
    // grande no se salte la resistencia. Hacen falta ~1,6 umbrales de dedo.
    // Al deshacer no hay resistencia: el indicador vuelve con el dedo.
    if (dy > 0) {
      for (let resto = dy; resto > 0; resto -= 10) {
        this.#distancia += Math.min(resto, 10) * Math.max(0.25, 1 - this.#distancia / (UMBRAL * 1.6));
      }
    } else {
      this.#distancia += dy;
    }
    // No se acumula el exceso: al invertir los dedos el indicador vuelve
    // inmediatamente, incluso después de un arrastre muy largo.
    this.#distancia = Math.max(0, Math.min(UMBRAL + 64, this.#distancia));
    if (!this.#fotograma) {
      this.#fotograma = this.contentWindow.requestAnimationFrame(() => {
        this.#fotograma = 0;
        this.#avisarProgreso();
      });
    }
  }

  #avisarProgreso() {
    this.sendAsyncMessage("progreso", {
      progreso: Math.min(1, this.#distancia / UMBRAL),
      recorrido: Math.min(64, this.#distancia) + Math.log1p(Math.max(0, this.#distancia - 64) / 64) * 12,
      alto: this.contentWindow.innerHeight,
    });
  }

  #soltar() {
    const activo = this.#estado === "arrastrando";
    const confirmar = activo && this.#distancia >= UMBRAL;
    // Soltar puede llegar antes del siguiente fotograma: la interfaz debe
    // recibir el último umbral antes de decidir si confirma la recarga.
    if (activo && this.#fotograma) this.#avisarProgreso();
    if (activo) this.sendAsyncMessage("soltar", confirmar);
    this.#reiniciar();
    // Tras un intento que no llegó, 250 ms basta para la cola del gesto y
    // permite reintentar enseguida (con 450 el segundo intento se perdía).
    if (activo) this.#bloqueadoHasta = this.contentWindow.performance.now() + (confirmar ? 800 : 250);
  }

  #reiniciar() {
    const win = this.contentWindow;
    win.clearTimeout(this.#fin);
    win.cancelAnimationFrame(this.#fotograma);
    this.#fin = this.#fotograma = 0;
    this.#estado = "reposo";
    this.#origen = null;
    this.#ultimoToque = null;
    this.#bajando = false;
    this.#x = this.#y = this.#distancia = 0;
  }

  #cancelar() {
    if (this.#estado === "arrastrando") this.sendAsyncMessage("cancelar");
    this.#reiniciar();
  }

  receiveMessage({ name }) {
    if (name === "cancelar") {
      this.#cancelar();
      this.#bloqueadoHasta = this.contentWindow.performance.now() + 450;
    }
  }
}

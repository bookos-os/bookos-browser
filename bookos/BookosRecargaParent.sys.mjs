export class BookosRecargaParent extends JSWindowActorParent {
  receiveMessage({ name, data }) {
    const browser = this.browsingContext.top.embedderElement;
    if (!browser || this.manager !== this.browsingContext.currentWindowGlobal) return;
    const win = browser.ownerDocument.defaultView;
    if (browser !== win.gBrowser?.selectedBrowser) return;
    if (name === "progreso") win.bookosRecarga?.actualizar(this, data);
    else if (name === "soltar") win.bookosRecarga?.soltar(this, data);
    else if (name === "cancelar") win.bookosRecarga?.cancelar(this);
  }
}

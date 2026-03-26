/**
 * marketplaceStore — store module-level léger pour partager les données
 * produit entre les écrans marketplace sans sérialisation URL complexe.
 */

let _products: any[] = [];
let _selected: any = null;

export const marketplaceStore = {
  setProducts(products: any[]) { _products = products; },
  getProducts() { return _products; },
  setSelected(item: any) { _selected = item; },
  getSelected() { return _selected; },
};

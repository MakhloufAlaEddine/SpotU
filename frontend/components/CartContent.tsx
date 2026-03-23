/**
 * CartContent — Composant partagé panier
 * Utilisé dans : MarketplaceModal (vue slide) + écran /cart (standalone)
 */
import React from 'react';
import {
  View, Text, StyleSheet, FlatList,
  TouchableOpacity, Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useCart, CartItem } from '../context/CartContext';
import { Colors, Spacing } from '../constants/Colors';
import { TagImage } from './TagImage';

const COBALT = '#3B82F6';

function rentalLabel(unit?: string, qty?: number): string {
  if (!unit) return '';
  const n = qty ?? 1;
  const map: Record<string, [string, string]> = {
    heure:   ['h',       'h'],
    jour:    ['jour',    'jours'],
    semaine: ['semaine', 'semaines'],
    mois:    ['mois',    'mois'],
  };
  const [s, p] = map[unit] ?? [unit, unit];
  return n > 1 ? `/${n} ${p}` : `/${s}`;
}

/* ─── Ligne article ──────────────────────────────────────────────────── */
function CartRow({ item }: { item: CartItem }) {
  const { updateQty, removeItem } = useCart();
  const isRental  = item.product_type === 'rental';
  const isFree    = item.price === 0;
  const suffix    = isRental ? rentalLabel(item.rental_duration_unit, item.rental_duration_qty) : '';
  const unitLabel = isFree ? 'Gratuit' : `${item.price.toFixed(2)} €${suffix}`;
  const totalLine = isFree ? 'Gratuit' : `${(item.price * item.quantity).toFixed(2)} €`;

  return (
    <View style={cs.row} testID={`cart-item-${item.product_id}`}>
      {/* Image */}
      <View style={cs.rowImgWrap}>
        <TagImage uri={item.image_url} tagIds={item.tag_ids || []} style={cs.rowImg} />
      </View>

      {/* Info */}
      <View style={cs.rowInfo}>
        <Text style={cs.rowTitle} numberOfLines={2}>{item.title}</Text>
        {item.seller_name && (
          <Text style={cs.rowSeller} numberOfLines={1}>{item.seller_name}</Text>
        )}
        <Text style={cs.rowUnit}>{unitLabel}</Text>

        <View style={cs.rowBottom}>
          {/* Quantité */}
          <View style={cs.qty}>
            <TouchableOpacity
              onPress={() => updateQty(item.product_id, item.quantity - 1)}
              style={cs.qtyBtn}
              testID={`cart-qty-minus-${item.product_id}`}
            >
              <Ionicons name="remove" size={13} color={Colors.foreground} />
            </TouchableOpacity>
            <Text style={cs.qtyVal}>{item.quantity}</Text>
            <TouchableOpacity
              onPress={() => updateQty(item.product_id, item.quantity + 1)}
              style={cs.qtyBtn}
              testID={`cart-qty-plus-${item.product_id}`}
            >
              <Ionicons name="add" size={13} color={Colors.foreground} />
            </TouchableOpacity>
          </View>
          <Text style={cs.rowTotal}>{totalLine}</Text>
        </View>
      </View>

      {/* Supprimer */}
      <TouchableOpacity
        onPress={() => removeItem(item.product_id)}
        style={cs.removeBtn}
        testID={`cart-remove-${item.product_id}`}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Ionicons name="trash-outline" size={16} color={Colors.muted} />
      </TouchableOpacity>
    </View>
  );
}

/* ─── CartContent ────────────────────────────────────────────────────── */
interface CartContentProps {
  onCheckout?: () => void;
}

export function CartContent({ onCheckout }: CartContentProps) {
  const { items, clearCart, totalItems, totalPrice } = useCart();

  if (items.length === 0) {
    return (
      <View style={cs.empty}>
        <View style={cs.emptyIconWrap}>
          <Ionicons name="cart-outline" size={44} color={Colors.muted} />
        </View>
        <Text style={cs.emptyTitle}>Panier vide</Text>
        <Text style={cs.emptySub}>Ajoutez des produits depuis la boutique</Text>
      </View>
    );
  }

  return (
    <View style={cs.container}>
      <FlatList
        data={items}
        keyExtractor={i => i.product_id}
        renderItem={({ item }) => <CartRow item={item} />}
        ItemSeparatorComponent={() => <View style={cs.sep} />}
        contentContainerStyle={cs.list}
        showsVerticalScrollIndicator={false}
        ListFooterComponent={<View style={{ height: 140 }} />}
      />

      {/* Footer collant */}
      <View style={cs.footer}>
        <View style={cs.totalRow}>
          <Text style={cs.totalLabel}>
            {totalItems} article{totalItems > 1 ? 's' : ''}
          </Text>
          <Text style={cs.totalPrice}>{totalPrice.toFixed(2)} €</Text>
        </View>

        <TouchableOpacity
          style={cs.checkoutBtn}
          onPress={onCheckout}
          activeOpacity={0.85}
          testID="cart-checkout-btn"
        >
          <Ionicons name="bag-check-outline" size={18} color="#fff" />
          <Text style={cs.checkoutTxt}>Procéder au paiement</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={clearCart}
          style={cs.clearBtn}
          testID="cart-clear-btn"
        >
          <Text style={cs.clearTxt}>Vider le panier</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

/* ─── Styles ─────────────────────────────────────────────────────────── */
const cs = StyleSheet.create({
  container:    { flex: 1 },
  list:         { paddingHorizontal: Spacing.md, paddingTop: Spacing.sm },

  /* Ligne article */
  row:          { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 10 },
  rowImgWrap:   { width: 64, height: 64, borderRadius: 10, overflow: 'hidden', backgroundColor: Colors.card, flexShrink: 0 },
  rowImg:       { width: 64, height: 64 },
  rowInfo:      { flex: 1, gap: 3 },
  rowTitle:     { fontSize: 13, fontWeight: '700', color: Colors.foreground, lineHeight: 17 },
  rowSeller:    { fontSize: 11, color: Colors.muted },
  rowUnit:      { fontSize: 11, color: Colors.muted },
  rowBottom:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  rowTotal:     { fontSize: 14, fontWeight: '800', color: COBALT },
  removeBtn:    { paddingTop: 2 },

  /* Quantité */
  qty:          { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.card, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden' },
  qtyBtn:       { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  qtyVal:       { minWidth: 24, textAlign: 'center', fontSize: 13, fontWeight: '700', color: Colors.foreground },

  sep:          { height: 1, backgroundColor: Colors.border, marginHorizontal: Spacing.md },

  /* Footer */
  footer:       { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: Colors.background, borderTopWidth: 1, borderTopColor: Colors.border, paddingHorizontal: Spacing.md, paddingTop: 14, paddingBottom: 28 },
  totalRow:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  totalLabel:   { fontSize: 14, color: Colors.muted, fontWeight: '500' },
  totalPrice:   { fontSize: 22, fontWeight: '800', color: Colors.foreground },
  checkoutBtn:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: COBALT, borderRadius: 14, height: 50, marginBottom: 8 },
  checkoutTxt:  { fontSize: 16, fontWeight: '700', color: '#fff' },
  clearBtn:     { alignItems: 'center', paddingVertical: 4 },
  clearTxt:     { fontSize: 13, color: Colors.muted },

  /* Empty */
  empty:        { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: Spacing.lg },
  emptyIconWrap:{ width: 80, height: 80, borderRadius: 40, backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.border, marginBottom: 4 },
  emptyTitle:   { fontSize: 18, fontWeight: '700', color: Colors.foreground },
  emptySub:     { fontSize: 13, color: Colors.muted, textAlign: 'center', lineHeight: 19 },
});

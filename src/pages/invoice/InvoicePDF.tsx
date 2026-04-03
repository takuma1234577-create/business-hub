import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Font,
} from '@react-pdf/renderer';
import type { InvoiceData, InvoiceItem, FeeTier } from './types';

const calcTieredFee = (amount: number, tiers: FeeTier[]): number => {
  let fee = 0;
  const sorted = [...tiers].sort((a, b) => a.min - b.min);
  for (const tier of sorted) {
    const min = tier.min || 0;
    const max = tier.max ?? Infinity;
    if (amount <= min) continue;
    const taxable = Math.min(amount, max) - min;
    fee += Math.round(taxable * (tier.rate / 100));
  }
  return fee;
};

const calcUnitPrice = (item: InvoiceItem): number => {
  if (item.itemType === 'fixed') return item.unitPrice;
  const base = item.baseAmount ?? 0;
  if (item.useTiered && item.tiers && item.tiers.length > 0) {
    return calcTieredFee(base, item.tiers);
  }
  return Math.round((base * (item.rate ?? 0)) / 100);
};

const unitPriceLabel = (item: InvoiceItem): string => {
  if (item.itemType === 'fixed') return `¥${item.unitPrice.toLocaleString()}`;
  const base = item.baseAmount ?? 0;
  if (item.useTiered && item.tiers && item.tiers.length > 0) {
    return `¥${base.toLocaleString()} × 段階制`;
  }
  return `¥${base.toLocaleString()} × ${item.rate}%`;
};

const tieredBreakdown = (item: InvoiceItem): string[] => {
  if (!item.useTiered || !item.tiers || item.tiers.length === 0) return [];
  const base = item.baseAmount ?? 0;
  const sorted = [...item.tiers].sort((a, b) => a.min - b.min);
  const lines: string[] = [];
  for (const tier of sorted) {
    const min = tier.min || 0;
    const max = tier.max ?? Infinity;
    if (base <= min) continue;
    const taxable = Math.min(base, max) - min;
    const tierFee = Math.round(taxable * (tier.rate / 100));
    const maxLabel = max === Infinity ? '〜' : `〜¥${max.toLocaleString()}`;
    lines.push(`¥${min.toLocaleString()}${maxLabel}: ¥${taxable.toLocaleString()} × ${tier.rate}% = ¥${tierFee.toLocaleString()}`);
  }
  return lines;
};

// Register fonts directly from CDN using TTF format (react-pdf does not support woff/woff2)
Font.register({
  family: 'NotoSansJP',
  fonts: [
    {
      src: 'https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-jp@5.0.1/files/noto-sans-jp-japanese-400-normal.ttf',
      fontWeight: 'normal',
    },
    {
      src: 'https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-jp@5.0.1/files/noto-sans-jp-japanese-700-normal.ttf',
      fontWeight: 'bold',
    },
  ],
});

export const ensureFontsLoaded = async () => {
  // Fonts are registered statically above; this is kept for API compatibility
};

const BLUE = '#2563eb';
const GRAY = '#6b7280';
const LIGHT_GRAY = '#e5e7eb';

const s = StyleSheet.create({
  page: {
    fontFamily: 'NotoSansJP',
    fontSize: 9,
    padding: 40,
    paddingBottom: 60,
    color: '#1a1a1a',
    backgroundColor: '#fff',
  },

  /* ── Header ── */
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 24,
    paddingBottom: 16,
    borderBottomWidth: 2,
    borderBottomColor: BLUE,
  },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    color: BLUE,
    letterSpacing: 2,
  },
  senderName: {
    fontSize: 11,
    fontWeight: 'bold',
    textAlign: 'right',
  },
  senderSub: {
    fontSize: 8,
    color: GRAY,
    marginTop: 3,
    textAlign: 'right',
  },

  /* ── Meta (invoice info + dates) & Bill To  ── */
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  metaLeft: {
    width: '48%',
  },
  metaRight: {
    width: '48%',
  },
  metaItem: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  metaLabel: {
    fontSize: 8,
    color: GRAY,
    width: 80,
  },
  metaValue: {
    fontSize: 9,
    flex: 1,
  },
  billToLabel: {
    fontSize: 8,
    color: GRAY,
    marginBottom: 4,
  },
  billToName: {
    fontSize: 13,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  billToDetail: {
    fontSize: 9,
    color: '#444',
    marginBottom: 1,
  },

  /* ── Table ── */
  table: {
    marginBottom: 16,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: BLUE,
    paddingVertical: 7,
    paddingHorizontal: 8,
    borderRadius: 3,
  },
  tableHeaderText: {
    color: '#fff',
    fontSize: 8,
    fontWeight: 'bold',
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 7,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: LIGHT_GRAY,
  },
  tableRowAlt: {
    backgroundColor: '#f8fafc',
  },
  col1: { flex: 5 },
  col2: { flex: 2, textAlign: 'right' },
  col3: { flex: 1, textAlign: 'center' },
  col4: { flex: 2, textAlign: 'right' },

  /* ── Totals ── */
  totalsWrap: {
    alignItems: 'flex-end',
    marginBottom: 20,
  },
  subtotalRow: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  subtotalLabel: {
    fontSize: 9,
    color: GRAY,
    textAlign: 'right',
    marginRight: 16,
  },
  subtotalValue: {
    fontSize: 10,
    textAlign: 'right',
  },
  grandRow: {
    flexDirection: 'row',
    backgroundColor: BLUE,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 3,
    alignItems: 'center',
  },
  grandLabel: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 11,
    marginRight: 24,
  },
  grandValue: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
    textAlign: 'right',
  },

  /* ── Bottom sections ── */
  bottomRow: {
    flexDirection: 'row',
    gap: 16,
  },
  notesBox: {
    flex: 1,
    padding: 10,
    backgroundColor: '#fffbeb',
    borderLeftWidth: 3,
    borderLeftColor: '#f59e0b',
    borderRadius: 2,
  },
  notesTitle: {
    fontSize: 8,
    fontWeight: 'bold',
    color: '#92400e',
    marginBottom: 4,
  },
  notesBody: {
    fontSize: 8,
    lineHeight: 1.5,
  },
  paymentBox: {
    flex: 1,
    padding: 10,
    borderWidth: 1,
    borderColor: LIGHT_GRAY,
    borderRadius: 4,
    backgroundColor: '#f9fafb',
  },
  paymentTitle: {
    fontSize: 8,
    fontWeight: 'bold',
    color: BLUE,
    marginBottom: 6,
  },
  paymentItem: {
    flexDirection: 'row',
    marginBottom: 3,
  },
  paymentKey: {
    width: 80,
    fontSize: 7,
    color: GRAY,
  },
  paymentVal: {
    fontSize: 8,
    flex: 1,
  },

  /* ── Footer ── */
  footer: {
    marginTop: 'auto',
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: LIGHT_GRAY,
    textAlign: 'center',
    fontSize: 8,
    color: GRAY,
  },
});

interface Props {
  invoice: InvoiceData;
  subtotal: number;
  total: number;
}

export function InvoicePDF({ invoice, subtotal, total }: Props) {
  const sdr = invoice.sender;
  const fmt = (d: string) => {
    const date = new Date(d);
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
  };

  const paymentRows = [
    ['通貨', sdr.currency],
    ['口座名義', sdr.bankAccountName],
    ['銀行', sdr.bankName],
    ['支店', sdr.bankBranch],
    ['口座番号', sdr.bankAccount],
    ...(sdr.bankSwift ? [['SWIFT', sdr.bankSwift]] : []),
  ].filter(([, v]) => v);

  return (
    <Document>
      <Page size="A4" style={s.page}>

        {/* ── Header ── */}
        <View style={s.header}>
          <Text style={s.title}>INVOICE</Text>
          <View>
            <Text style={s.senderName}>{sdr.senderName}</Text>
            {sdr.senderCompany ? <Text style={s.senderSub}>{sdr.senderCompany}</Text> : null}
            {sdr.senderPostalCode ? <Text style={s.senderSub}>〒{sdr.senderPostalCode}</Text> : null}
            {sdr.senderAddress ? <Text style={s.senderSub}>{sdr.senderAddress}</Text> : null}
            {sdr.senderPhone ? <Text style={s.senderSub}>TEL: {sdr.senderPhone}</Text> : null}
            {sdr.senderEmail ? <Text style={s.senderSub}>{sdr.senderEmail}</Text> : null}
          </View>
        </View>

        {/* ── Meta info + Bill To ── */}
        <View style={s.metaRow}>
          {/* Left: invoice meta */}
          <View style={s.metaLeft}>
            <View style={s.metaItem}>
              <Text style={s.metaLabel}>請求日</Text>
              <Text style={s.metaValue}>{fmt(invoice.issueDate)}</Text>
            </View>
            <View style={s.metaItem}>
              <Text style={s.metaLabel}>支払期限</Text>
              <Text style={s.metaValue}>{fmt(invoice.dueDate)}</Text>
            </View>
          </View>

          {/* Right: bill to */}
          <View style={s.metaRight}>
            <Text style={s.billToLabel}>請求先 / BILL TO</Text>
            <Text style={s.billToName}>{invoice.client.companyName} 御中</Text>
            {invoice.client.contactName ? (
              <Text style={s.billToDetail}>{invoice.client.contactName} 様</Text>
            ) : null}
            {invoice.client.postalCode ? (
              <Text style={s.billToDetail}>〒{invoice.client.postalCode}</Text>
            ) : null}
            {invoice.client.address ? (
              <Text style={s.billToDetail}>{invoice.client.address}</Text>
            ) : null}
          </View>
        </View>

        {/* ── Table ── */}
        <View style={s.table}>
          <View style={s.tableHeader}>
            <Text style={[s.col1, s.tableHeaderText]}>品目</Text>
            <Text style={[s.col2, s.tableHeaderText]}>単価</Text>
            <Text style={[s.col3, s.tableHeaderText]}>数量</Text>
            <Text style={[s.col4, s.tableHeaderText]}>金額</Text>
          </View>
          {invoice.items.map((item, i) => {
            const price = calcUnitPrice(item);
            const amount = item.itemType === 'fixed' ? price * item.quantity : price;
            const breakdown = tieredBreakdown(item);
            return (
              <View key={item.id}>
                <View style={[s.tableRow, i % 2 === 1 ? s.tableRowAlt : {}]}>
                  <Text style={s.col1}>{item.description}</Text>
                  <Text style={s.col2}>{unitPriceLabel(item)}</Text>
                  <Text style={s.col3}>{item.itemType === 'fixed' ? String(item.quantity) : '-'}</Text>
                  <Text style={s.col4}>¥{amount.toLocaleString()}</Text>
                </View>
                {breakdown.length > 0 && (
                  <View style={{ paddingHorizontal: 12, paddingVertical: 4, backgroundColor: '#f0f4ff' }}>
                    {breakdown.map((line, j) => (
                      <Text key={j} style={{ fontSize: 7, color: '#4b5563', marginBottom: 1 }}>{line}</Text>
                    ))}
                  </View>
                )}
              </View>
            );
          })}
        </View>

        {/* ── Totals ── */}
        <View style={s.totalsWrap}>
          <View style={s.subtotalRow}>
            <Text style={s.subtotalLabel}>小計 (SUB-TOTAL)</Text>
            <Text style={s.subtotalValue}>¥{subtotal.toLocaleString()}</Text>
          </View>
          <View style={s.grandRow}>
            <Text style={s.grandLabel}>合計 (TOTAL)</Text>
            <Text style={s.grandValue}>¥{total.toLocaleString()}</Text>
          </View>
        </View>

        {/* ── Notes + Payment side by side ── */}
        <View style={s.bottomRow}>
          {invoice.notes ? (
            <View style={s.notesBox}>
              <Text style={s.notesTitle}>備考 / NOTES</Text>
              <Text style={s.notesBody}>{invoice.notes}</Text>
            </View>
          ) : null}
          <View style={s.paymentBox}>
            <Text style={s.paymentTitle}>お振込先 / PAYMENT</Text>
            {paymentRows.map(([k, v], i) => (
              <View key={i} style={s.paymentItem}>
                <Text style={s.paymentKey}>{k}</Text>
                <Text style={s.paymentVal}>{v}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* ── Footer (flows after content, pushed to bottom by marginTop auto) ── */}
        <Text style={s.footer}>Thank You For Your Business</Text>

      </Page>
    </Document>
  );
}

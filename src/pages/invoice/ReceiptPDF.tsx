import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Font,
} from '@react-pdf/renderer';
import type { ReceiptData } from './types';

// InvoicePDF と同じ NotoSansJP を利用（同一 family の再登録は無害）
Font.register({
  family: 'NotoSansJP',
  fonts: [
    {
      src: 'https://fonts.gstatic.com/s/notosansjp/v56/-F6jfjtqLzI2JPCgQBnw7HFyzSD-AsregP8VFBEj75s.ttf',
      fontWeight: 'normal',
    },
    {
      src: 'https://fonts.gstatic.com/s/notosansjp/v56/-F6jfjtqLzI2JPCgQBnw7HFyzSD-AsregP8VFPYk75s.ttf',
      fontWeight: 'bold',
    },
  ],
});

const BLUE = '#2563eb';
const GRAY = '#6b7280';
const LIGHT_GRAY = '#e5e7eb';

const s = StyleSheet.create({
  page: {
    fontFamily: 'NotoSansJP',
    fontSize: 10,
    padding: 44,
    color: '#1a1a1a',
    backgroundColor: '#fff',
  },

  /* ── Title ── */
  titleWrap: {
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 30,
    fontWeight: 'bold',
    color: BLUE,
    letterSpacing: 8,
  },
  titleRule: {
    marginTop: 8,
    width: 160,
    borderBottomWidth: 2,
    borderBottomColor: BLUE,
  },

  /* ── Meta (No / date) ── */
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 18,
  },
  metaItem: {
    flexDirection: 'row',
    marginLeft: 24,
  },
  metaLabel: {
    fontSize: 8,
    color: GRAY,
    marginRight: 6,
  },
  metaValue: {
    fontSize: 9,
  },

  /* ── 宛名 ── */
  addressee: {
    fontSize: 16,
    fontWeight: 'bold',
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
    paddingBottom: 4,
    marginBottom: 20,
    width: '62%',
  },

  /* ── 金額 ── */
  amountBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: BLUE,
    borderRadius: 4,
    paddingVertical: 12,
    paddingHorizontal: 18,
    marginBottom: 16,
  },
  amountLabel: {
    fontSize: 12,
    fontWeight: 'bold',
    color: BLUE,
    marginRight: 20,
  },
  amountValue: {
    fontSize: 24,
    fontWeight: 'bold',
    flex: 1,
    textAlign: 'right',
    letterSpacing: 1,
  },

  /* ── 但し書き ── */
  subjectRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  subjectLabel: {
    fontSize: 10,
    marginRight: 8,
  },
  subjectValue: {
    flex: 1,
    fontSize: 10,
    borderBottomWidth: 1,
    borderBottomColor: LIGHT_GRAY,
    paddingBottom: 2,
  },
  statement: {
    fontSize: 10,
    marginBottom: 20,
  },

  /* ── 内訳 + お支払方法 ── */
  detailRow: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 24,
  },
  breakdownBox: {
    flex: 1,
    borderWidth: 1,
    borderColor: LIGHT_GRAY,
    borderRadius: 4,
    padding: 10,
    backgroundColor: '#f9fafb',
  },
  breakdownTitle: {
    fontSize: 8,
    fontWeight: 'bold',
    color: BLUE,
    marginBottom: 6,
  },
  breakdownItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 3,
  },
  breakdownKey: {
    fontSize: 8,
    color: GRAY,
  },
  breakdownVal: {
    fontSize: 9,
  },

  /* ── 下部：発行者 ── */
  bottomRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'flex-end',
    marginTop: 12,
  },
  sender: {
    width: '58%',
    alignItems: 'flex-end',
  },
  senderName: {
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 3,
  },
  senderSub: {
    fontSize: 8,
    color: GRAY,
    marginBottom: 1,
    textAlign: 'right',
  },

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
  receipt: ReceiptData;
}

export function ReceiptPDF({ receipt }: Props) {
  const sdr = receipt.sender;
  const fmt = (d: string) => {
    const date = new Date(d);
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
  };

  return (
    <Document>
      <Page size="A4" style={s.page}>

        {/* ── Title ── */}
        <View style={s.titleWrap}>
          <Text style={s.title}>領収書</Text>
          <View style={s.titleRule} />
        </View>

        {/* ── No / 発行日 ── */}
        <View style={s.metaRow}>
          {receipt.receiptNumber ? (
            <View style={s.metaItem}>
              <Text style={s.metaLabel}>No.</Text>
              <Text style={s.metaValue}>{receipt.receiptNumber}</Text>
            </View>
          ) : null}
          <View style={s.metaItem}>
            <Text style={s.metaLabel}>発行日</Text>
            <Text style={s.metaValue}>{fmt(receipt.issueDate)}</Text>
          </View>
        </View>

        {/* ── 宛名 ── */}
        <Text style={s.addressee}>
          {receipt.client.companyName ? `${receipt.client.companyName} 御中` : '　'}
          {receipt.client.contactName ? `　${receipt.client.contactName} 様` : ''}
        </Text>

        {/* ── 金額 ── */}
        <View style={s.amountBox}>
          <Text style={s.amountLabel}>金額</Text>
          <Text style={s.amountValue}>¥{receipt.amount.toLocaleString()}-</Text>
        </View>

        {/* ── 但し書き ── */}
        <View style={s.subjectRow}>
          <Text style={s.subjectLabel}>但し</Text>
          <Text style={s.subjectValue}>{receipt.subject || ''} として</Text>
        </View>
        <Text style={s.statement}>上記正に領収いたしました。</Text>

        {/* ── お支払方法 ── */}
        <View style={s.detailRow}>
          <View style={s.breakdownBox}>
            <Text style={s.breakdownTitle}>お支払方法</Text>
            <Text style={s.breakdownVal}>{receipt.paymentMethod || '—'}</Text>
            {receipt.notes ? (
              <>
                <Text style={[s.breakdownTitle, { marginTop: 8 }]}>備考</Text>
                <Text style={[s.breakdownVal, { fontSize: 8, lineHeight: 1.5 }]}>{receipt.notes}</Text>
              </>
            ) : null}
          </View>
        </View>

        {/* ── 発行者 ── */}
        <View style={s.bottomRow}>
          <View style={s.sender}>
            <Text style={s.senderName}>{sdr.senderName}</Text>
            {sdr.senderCompany ? <Text style={s.senderSub}>{sdr.senderCompany}</Text> : null}
            {sdr.senderPostalCode ? <Text style={s.senderSub}>〒{sdr.senderPostalCode}</Text> : null}
            {sdr.senderAddress ? <Text style={s.senderSub}>{sdr.senderAddress}</Text> : null}
            {sdr.senderPhone ? <Text style={s.senderSub}>TEL: {sdr.senderPhone}</Text> : null}
            {sdr.senderEmail ? <Text style={s.senderSub}>{sdr.senderEmail}</Text> : null}
          </View>
        </View>

        <Text style={s.footer}>Thank You For Your Business</Text>

      </Page>
    </Document>
  );
}

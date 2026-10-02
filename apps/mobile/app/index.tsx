import { MIN_TOUCH_TARGET, radius, space, strings, typography } from '@q2c/ui';
import { formatMoney, toE164IL } from '@q2c/utils';
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText } from '../src/components/AppText';
import { isRtl } from '../src/rtl';
import { useThemeColors } from '../src/theme';

const FLOW_STEPS = [
  strings.flow.customer,
  strings.flow.quote,
  strings.flow.approval,
  strings.flow.scheduling,
  strings.flow.job,
  strings.flow.invoice,
  strings.flow.payment,
];

const SAMPLE_AMOUNT_MINOR = 123450;
const SAMPLE_PHONE = toE164IL('052-123-4567');

export default function HomeScreen() {
  const colors = useThemeColors();
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View>
          <AppText variant="title" accessibilityRole="header">
            {strings.app.name}
          </AppText>
          <AppText variant="muted">{strings.app.tagline}</AppText>
        </View>

        <Card>
          <AppText variant="heading">{strings.home.title}</AppText>
          <AppText>{strings.home.subtitle}</AppText>
        </Card>

        <Card>
          <AppText variant="heading">{strings.home.flowTitle}</AppText>
          <View style={styles.flow}>
            {FLOW_STEPS.map((step, index) => (
              <View key={step} style={[styles.chip, { backgroundColor: colors.primary }]}>
                <View style={[styles.chipIndex, { backgroundColor: colors.accent }]}>
                  <AppText style={[styles.chipIndexText, { color: colors.onAccent }]}>
                    {index + 1}
                  </AppText>
                </View>
                <AppText style={{ color: colors.onPrimary }}>{step}</AppText>
              </View>
            ))}
          </View>
        </Card>

        <Card>
          <AppText variant="heading">{strings.home.sampleTitle}</AppText>
          <Row label={strings.home.sampleAmountLabel} value={formatMoney(SAMPLE_AMOUNT_MINOR)} />
          <Row label={strings.home.samplePhoneLabel} value={SAMPLE_PHONE ?? ''} ltr />
          <Row
            label={strings.home.directionLabel}
            value={isRtl() ? strings.home.directionRtl : strings.home.directionLtr}
          />
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

function Card({ children }: { children: ReactNode }) {
  const colors = useThemeColors();
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {children}
    </View>
  );
}

function Row({ label, value, ltr = false }: { label: string; value: string; ltr?: boolean }) {
  return (
    <View style={styles.row}>
      <AppText variant="muted">{label}</AppText>
      <AppText style={ltr ? styles.ltr : undefined}>{value}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { padding: space(2), gap: space(3) },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: space(2),
    gap: space(1),
  },
  flow: { flexDirection: 'row', flexWrap: 'wrap', gap: space(1) },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(1),
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: space(2),
    borderRadius: radius.md,
  },
  chipIndex: {
    width: space(3),
    height: space(3),
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipIndexText: {
    fontFamily: typography.nativeFamily.bold,
    fontSize: typography.size.sm,
    lineHeight: typography.lineHeight.sm,
    textAlign: 'center',
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: space(2) },
  ltr: { writingDirection: 'ltr' },
});

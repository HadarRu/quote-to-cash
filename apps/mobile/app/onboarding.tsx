import { radius, space, strings, format } from '@q2c/ui';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useAuth } from '../src/auth/AuthProvider';
import { AppText } from '../src/components/AppText';
import { Button } from '../src/components/Button';
import { Screen } from '../src/components/Screen';
import { useThemeColors } from '../src/theme';

const slides = strings.onboarding.slides;

/** Three short intro slides; skippable, shown once per device. */
export default function Onboarding() {
  const colors = useThemeColors();
  const { completeOnboarding } = useAuth();
  const [index, setIndex] = useState(0);
  const slide = slides[index] ?? slides[0];
  const last = index === slides.length - 1;

  return (
    <Screen
      footer={
        <>
          <Button
            testID="onboarding-next"
            label={last ? strings.onboarding.start : strings.onboarding.next}
            onPress={() => (last ? void completeOnboarding() : setIndex(index + 1))}
          />
          {last ? null : (
            <Button
              testID="onboarding-skip"
              variant="ghost"
              label={strings.onboarding.skip}
              onPress={completeOnboarding}
            />
          )}
        </>
      }
    >
      <View style={[styles.hero, { backgroundColor: colors.primary }]}>
        <AppText variant="title" style={{ color: colors.onPrimary }}>
          {String(index + 1)}
        </AppText>
      </View>
      <View style={styles.text}>
        <AppText variant="title" accessibilityRole="header">
          {slide.title}
        </AppText>
        <AppText>{slide.body}</AppText>
      </View>
      <View
        style={styles.dots}
        accessibilityLabel={format(strings.onboarding.stepOf, {
          current: index + 1,
          total: slides.length,
        })}
      >
        {slides.map((s, i) => (
          <View
            key={s.title}
            style={[styles.dot, { backgroundColor: i === index ? colors.primary : colors.border }]}
          />
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { height: 160, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  text: { gap: space(1) },
  dots: { flexDirection: 'row', gap: space(1), justifyContent: 'center' },
  dot: { width: space(1), height: space(1), borderRadius: radius.full },
});

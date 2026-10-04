import { SLOTS_MAX } from '@q2c/types';
import { format, radius, space, strings } from '@q2c/ui';
import { formatSlotIL } from '@q2c/utils';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from '../components/AppText';
import { Button } from '../components/Button';
import { ChoiceChips } from '../components/ChoiceChips';
import { useThemeColors } from '../theme';
import { slotDayOptions, SLOT_DURATIONS, SLOT_HOURS, toSlot, type SlotChoice } from './slots';

const t = strings.quotes;

const hourOptions = SLOT_HOURS.map((h) => ({
  value: String(h),
  label: `${String(h).padStart(2, '0')}:00`,
}));
const durationOptions = SLOT_DURATIONS.map((h) => ({
  value: String(h),
  label: h === 1 ? t.slotOneHour : format(t.slotHours, { hours: h }),
}));

export const slotLabel = (choice: SlotChoice) => {
  const slot = toSlot(choice);
  return formatSlotIL(slot.startsAt, slot.endsAt);
};

/** Up to 3 proposed visit times: day, start hour and length, picked with chips. */
export function SlotPicker({
  value,
  onChange,
  disabled,
}: {
  value: SlotChoice[];
  onChange: (next: SlotChoice[]) => void;
  disabled?: boolean;
}) {
  const colors = useThemeColors();
  const days = useMemo(() => slotDayOptions(new Date()), []);
  const [draft, setDraft] = useState<SlotChoice | null>(null);

  const startNew = () => setDraft({ day: days[1]!.value, hour: 8, hours: 2 });

  return (
    <View
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
      testID="quote-slots"
    >
      <AppText variant="heading">{t.slotsTitle}</AppText>
      <AppText variant="muted">{t.slotsHint}</AppText>

      {value.map((choice, i) => (
        <View key={`${choice.day}-${choice.hour}-${i}`} style={styles.row}>
          <AppText style={styles.grow} testID={`quote-slot-${i}`}>
            {slotLabel(choice)}
          </AppText>
          <Button
            variant="ghost"
            label={format(t.slotRemove, { n: i + 1 })}
            onPress={() => onChange(value.filter((_, j) => j !== i))}
            disabled={disabled}
          />
        </View>
      ))}

      {draft ? (
        <>
          <ChoiceChips
            label={t.slotDay}
            options={days}
            value={draft.day}
            onChange={(day) => setDraft({ ...draft, day })}
            testID="slot-day"
          />
          <ChoiceChips
            label={t.slotStart}
            options={hourOptions}
            value={String(draft.hour)}
            onChange={(hour) => setDraft({ ...draft, hour: Number(hour) })}
            testID="slot-hour"
          />
          <ChoiceChips
            label={t.slotDuration}
            options={durationOptions}
            value={String(draft.hours)}
            onChange={(hours) => setDraft({ ...draft, hours: Number(hours) })}
            testID="slot-duration"
          />
          <Button
            testID="slot-add-confirm"
            variant="secondary"
            label={t.slotAdd}
            onPress={() => {
              onChange([...value, draft]);
              setDraft(null);
            }}
          />
          <Button variant="ghost" label={t.slotCancel} onPress={() => setDraft(null)} />
        </>
      ) : value.length < SLOTS_MAX ? (
        <Button
          testID="slot-add"
          variant="secondary"
          label={value.length ? t.slotAddAnother : t.slotAdd}
          onPress={startNew}
          disabled={disabled}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: space(2),
    gap: space(1),
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(1) },
  grow: { flex: 1 },
});

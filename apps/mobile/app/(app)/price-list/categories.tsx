import { errorMessage, format, radius, space, strings } from '@q2c/ui';
import { randomUUID } from 'expo-crypto';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { AppText } from '../../../src/components/AppText';
import { Banner } from '../../../src/components/Banner';
import { Button } from '../../../src/components/Button';
import { FullScreenMessage } from '../../../src/components/FullScreenMessage';
import { Screen } from '../../../src/components/Screen';
import { TextField } from '../../../src/components/TextField';
import type { PriceListCategory } from '../../../src/price-list/model';
import { deleteCategory, saveCategory, type WriteResult } from '../../../src/price-list/service';
import { usePriceList } from '../../../src/price-list/usePriceList';
import { useThemeColors } from '../../../src/theme';

/** Add, rename and delete price list categories. */
export default function Categories() {
  const colors = useThemeColors();
  const { state, reload, db, business } = usePriceList();
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (state.status === 'loading') {
    return (
      <Screen title={strings.priceList.categoriesTitle}>
        <ActivityIndicator color={colors.primary} />
      </Screen>
    );
  }
  if (state.status === 'error') {
    return (
      <FullScreenMessage
        title={strings.states.error}
        body={state.error === 'network' ? strings.errors.network : strings.errors.generic}
        actionLabel={strings.states.retry}
        onAction={() => void reload()}
      />
    );
  }

  const add = async () => {
    setError(null);
    const result = await saveCategory(db, business.id, { id: randomUUID(), name: newName });
    if (!result.ok) return setError(errorMessage(result.error));
    setNewName('');
    await reload();
  };

  return (
    <Screen title={strings.priceList.categoriesTitle}>
      <View style={styles.add}>
        <View style={styles.grow}>
          <TextField
            testID="category-new"
            label={strings.priceList.newCategory}
            placeholder={strings.priceList.newCategoryPlaceholder}
            value={newName}
            onChangeText={setNewName}
            error={error}
          />
        </View>
        <Button
          testID="category-add"
          label={strings.priceList.addCategory}
          onPress={add}
          disabled={!newName.trim()}
        />
      </View>
      {state.data.categories.length === 0 ? (
        <AppText variant="muted" testID="categories-empty">
          {strings.priceList.categoriesEmpty}
        </AppText>
      ) : (
        state.data.categories.map((c) => (
          <CategoryRow
            key={c.id}
            category={c}
            onChanged={() => void reload()}
            save={(name) => saveCategory(db, business.id, { id: c.id, name })}
            remove={() => deleteCategory(db, c.id)}
          />
        ))
      )}
      <Button
        variant="ghost"
        label={strings.priceList.back}
        onPress={() => router.dismissTo('/price-list')}
      />
    </Screen>
  );
}

interface CategoryRowProps {
  category: PriceListCategory;
  save: (name: string) => Promise<WriteResult>;
  remove: () => Promise<WriteResult>;
  onChanged: () => void;
}

function CategoryRow({ category, save, remove, onChanged }: CategoryRowProps) {
  const colors = useThemeColors();
  const [mode, setMode] = useState<'view' | 'rename' | 'confirmDelete'>('view');
  const [name, setName] = useState(category.name);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<WriteResult>) => {
    setError(null);
    const result = await action();
    if (!result.ok) return setError(errorMessage(result.error));
    setMode('view');
    onChanged();
  };

  return (
    <View
      testID="category-row"
      style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      {mode === 'rename' ? (
        <>
          <TextField
            label={strings.priceList.rename}
            value={name}
            onChangeText={setName}
            autoFocus
          />
          <Button label={strings.priceList.save} onPress={() => run(() => save(name))} />
          <Button
            variant="ghost"
            label={strings.priceList.cancel}
            onPress={() => setMode('view')}
          />
        </>
      ) : mode === 'confirmDelete' ? (
        <>
          <AppText>
            {format(strings.priceList.deleteCategoryConfirm, { name: category.name })}
          </AppText>
          <Button
            variant="danger"
            label={strings.priceList.deleteYes}
            onPress={() => run(remove)}
          />
          <Button
            variant="ghost"
            label={strings.priceList.cancel}
            onPress={() => setMode('view')}
          />
        </>
      ) : (
        <View style={styles.rowLine}>
          <AppText variant="heading" style={styles.grow}>
            {category.name}
          </AppText>
          <Button
            variant="ghost"
            label={strings.priceList.rename}
            onPress={() => setMode('rename')}
          />
          <Button
            variant="ghost"
            label={strings.priceList.deleteCategory}
            onPress={() => setMode('confirmDelete')}
          />
        </View>
      )}
      {error ? <Banner tone="error" message={error} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  add: { flexDirection: 'row', alignItems: 'flex-end', gap: space(1) },
  grow: { flex: 1 },
  row: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: space(1.5),
    gap: space(1),
  },
  rowLine: { flexDirection: 'row', alignItems: 'center', gap: space(1) },
});

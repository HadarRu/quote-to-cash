import { SERVICE_UNITS, type ServiceUnit } from '@q2c/types';
import { errorMessage, format, space, strings } from '@q2c/ui';
import { randomUUID } from 'expo-crypto';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useCurrentBusiness } from '../auth/AuthProvider';
import { AppText } from '../components/AppText';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { ChoiceChips } from '../components/ChoiceChips';
import { TextField } from '../components/TextField';
import { Toggle } from '../components/Toggle';
import { getSupabase } from '../lib/supabase';
import { supabasePriceListDb } from './db';
import { priceInputValue, type PriceListCategory, type PriceListService } from './model';
import { deleteService, saveCategory, saveService, type FieldErrors } from './service';

const NO_CATEGORY = 'none';
const unitOptions = SERVICE_UNITS.map((value) => ({ value, label: strings.units[value] }));
const vatOptions = [
  { value: 'excluded', label: strings.priceList.vatExcluded },
  { value: 'included', label: strings.priceList.vatIncluded },
] as const;

interface ServiceFormProps {
  categories: readonly PriceListCategory[];
  /** Absent for a new service. */
  service?: PriceListService;
  onSaved: () => void;
  onDeleted?: () => void;
  /** Called after a category was created here, so the caller can reload. */
  onCategoryCreated?: () => void;
}

/** Add / Edit Service: name, category, unit, price, VAT flag, favorite. */
export function ServiceForm({
  categories,
  service,
  onSaved,
  onDeleted,
  onCategoryCreated,
}: ServiceFormProps) {
  const { business } = useCurrentBusiness();
  const db = useMemo(() => supabasePriceListDb(getSupabase()), []);
  const [id] = useState(() => service?.id ?? randomUUID());
  const [name, setName] = useState(service?.name ?? '');
  const [categoryId, setCategoryId] = useState<string>(service?.categoryId ?? NO_CATEGORY);
  const [extraCategories, setExtraCategories] = useState<PriceListCategory[]>([]);
  const [newCategory, setNewCategory] = useState('');
  const [unit, setUnit] = useState<ServiceUnit>(service?.unit ?? 'unit');
  const [priceText, setPriceText] = useState(service ? priceInputValue(service.priceMinor) : '');
  const [vat, setVat] = useState<'included' | 'excluded'>(
    service?.vatIncluded ? 'included' : 'excluded',
  );
  const [isFavorite, setIsFavorite] = useState(service?.isFavorite ?? false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<'name' | 'priceMinor' | 'unit'>>({});
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const categoryOptions = [
    // Categories created here show at once; after the reload they come from `categories`.
    ...[
      ...categories,
      ...extraCategories.filter((e) => !categories.some((c) => c.id === e.id)),
    ].map((c) => ({
      value: c.id,
      label: c.name,
    })),
    { value: NO_CATEGORY, label: strings.priceList.noCategory },
  ];

  const addCategory = async () => {
    setCategoryError(null);
    const created = {
      id: randomUUID(),
      name: newCategory.trim(),
      sortOrder: categories.length + 1,
    };
    const result = await saveCategory(db, business.id, created);
    if (!result.ok) return setCategoryError(errorMessage(result.error));
    setExtraCategories((list) => [...list, created]);
    setCategoryId(created.id);
    setNewCategory('');
    onCategoryCreated?.();
  };

  const save = async () => {
    setError(null);
    setSaving(true);
    const result = await saveService(db, business.id, {
      id,
      name,
      categoryId: categoryId === NO_CATEGORY ? null : categoryId,
      unit,
      priceText,
      vatIncluded: vat === 'included',
      isFavorite,
    });
    setSaving(false);
    if (result.ok) return onSaved();
    if ('fieldErrors' in result) return setFieldErrors(result.fieldErrors);
    setError(errorMessage(result.error));
  };

  const remove = async () => {
    if (!service) return;
    setSaving(true);
    const result = await deleteService(db, service.id);
    setSaving(false);
    if (!result.ok) return setError(errorMessage(result.error));
    onDeleted?.();
  };

  const fieldError = (key: 'name' | 'priceMinor' | 'unit') => {
    const code = fieldErrors[key];
    return code ? errorMessage(code) : null;
  };

  return (
    <View style={styles.form}>
      <TextField
        testID="service-name"
        label={strings.priceList.nameLabel}
        placeholder={strings.priceList.namePlaceholder}
        value={name}
        onChangeText={(text) => {
          setName(text);
          setFieldErrors((e) => ({ ...e, name: undefined }));
        }}
        error={fieldError('name')}
        autoFocus={!service}
      />
      <TextField
        testID="service-price"
        label={strings.priceList.priceLabel}
        value={priceText}
        onChangeText={(text) => {
          setPriceText(text);
          setFieldErrors((e) => ({ ...e, priceMinor: undefined }));
        }}
        error={fieldError('priceMinor')}
        keyboardType="decimal-pad"
        inputMode="decimal"
      />
      <ChoiceChips
        testID="service-vat"
        label={strings.priceList.vatLabel}
        options={vatOptions}
        value={vat}
        onChange={setVat}
      />
      <ChoiceChips
        testID="service-unit"
        label={strings.priceList.unitLabel}
        options={unitOptions}
        value={unit}
        onChange={setUnit}
        error={fieldError('unit')}
      />
      <ChoiceChips
        testID="service-category"
        label={strings.priceList.categoryLabel}
        options={categoryOptions}
        value={categoryId}
        onChange={setCategoryId}
      />
      <View style={styles.newCategory}>
        <View style={styles.grow}>
          <TextField
            testID="service-new-category"
            label={strings.priceList.newCategory}
            placeholder={strings.priceList.newCategoryPlaceholder}
            value={newCategory}
            onChangeText={setNewCategory}
            error={categoryError}
          />
        </View>
        <Button
          testID="service-add-category"
          variant="secondary"
          label={strings.priceList.addCategory}
          onPress={addCategory}
          disabled={!newCategory.trim()}
        />
      </View>
      <Toggle
        testID="service-favorite"
        label={strings.priceList.favoriteLabel}
        value={isFavorite}
        onChange={setIsFavorite}
      />
      {error ? <Banner tone="error" testID="service-error" message={error} /> : null}
      <Button
        testID="service-save"
        label={strings.priceList.save}
        onPress={save}
        loading={saving}
      />
      {service && onDeleted ? (
        confirmingDelete ? (
          <View style={styles.confirm}>
            <AppText>{format(strings.priceList.deleteConfirm, { name: service.name })}</AppText>
            <Button
              testID="service-delete-confirm"
              variant="danger"
              label={strings.priceList.deleteYes}
              onPress={remove}
            />
            <Button
              variant="ghost"
              label={strings.priceList.cancel}
              onPress={() => setConfirmingDelete(false)}
            />
          </View>
        ) : (
          <Button
            testID="service-delete"
            variant="ghost"
            label={strings.priceList.delete}
            onPress={() => setConfirmingDelete(true)}
          />
        )
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: space(2) },
  newCategory: { flexDirection: 'row', alignItems: 'flex-end', gap: space(1) },
  grow: { flex: 1 },
  confirm: { gap: space(1) },
});

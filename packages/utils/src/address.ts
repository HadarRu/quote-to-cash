export interface AddressParts {
  street: string;
  houseNumber?: string | null;
  apartment?: string | null;
  city: string;
}

/** One-line address: "הרצל 5, דירה 3, חיפה". The apartment label comes from the i18n file. */
export function formatAddressLine(address: AddressParts, apartmentLabel: string): string {
  return [
    [address.street, address.houseNumber].filter(Boolean).join(' '),
    address.apartment ? `${apartmentLabel} ${address.apartment}` : null,
    address.city,
  ]
    .filter(Boolean)
    .join(', ');
}

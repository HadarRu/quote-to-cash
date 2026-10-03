import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

/** Long enough for detail on a phone screen, small enough to upload on a weak connection. */
const MAX_WIDTH = 1600;
const JPEG_QUALITY = 0.7;

export type PhotoResult =
  { ok: true; base64: string } | { ok: false; reason: 'cancelled' | 'failed' };

/**
 * Takes a photo (or picks one) and compresses it on the device to a JPEG of at
 * most 1600px wide. The result is kept as base64 so it survives restarts until
 * the outbox has uploaded it.
 */
export async function takeQuotePhoto(source: 'camera' | 'library'): Promise<PhotoResult> {
  try {
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1 };
    if (source === 'camera') {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) return { ok: false, reason: 'failed' };
    }
    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);
    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset) return { ok: false, reason: 'cancelled' };

    const context = ImageManipulator.manipulate(asset.uri);
    if (asset.width > MAX_WIDTH) context.resize({ width: MAX_WIDTH });
    const image = await context.renderAsync();
    const saved = await image.saveAsync({
      format: SaveFormat.JPEG,
      compress: JPEG_QUALITY,
      base64: true,
    });
    return saved.base64 ? { ok: true, base64: saved.base64 } : { ok: false, reason: 'failed' };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

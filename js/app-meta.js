/**
 * @file app-meta.js
 * @description The app's own identity. One constant in its own module because
 * two unrelated places render it now: the About row in the settings dialog and
 * the signature in the corner of the Languages tab. Neither should have to
 * import the other to read a version string.
 *
 * The name is not here — it comes from the i18n key `app.title`, which is the
 * same proper noun in every locale and so follows the same path as any other
 * piece of interface text.
 *
 * Bump on release.
 */

export const APP_VERSION = 'v1.12.7';

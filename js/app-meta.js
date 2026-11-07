/**
 * @file app-meta.js
 * @description The app's own identity. One constant in its own module so the
 * About row in the settings dialog does not own it: anything else that needs
 * the version string imports it from here.
 *
 * The name is not here — it comes from the i18n key `app.title`, which is the
 * same proper noun in every locale and so follows the same path as any other
 * piece of interface text.
 *
 * Bump on release.
 */

export const APP_VERSION = 'v1.37.0';

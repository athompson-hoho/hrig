import { createContext, useContext } from "react";
import {
  defaults,
  type Preferences,
  type Overrides,
  type SettingKey,
  type SettingsScope,
} from "./settings";
import type { RecentChange } from "./settings-recent";
export const SettingsContext = createContext<{
  effective: Preferences;
  user: Overrides;
  project: Overrides;
  recent: RecentChange[];
  update: (scope: SettingsScope, key: SettingKey, value: unknown) => void;
  replace: (scope: SettingsScope, value: Overrides) => void;
  reset: (scope: SettingsScope, key?: SettingKey) => void;
}>({
  effective: defaults,
  user: {},
  project: {},
  recent: [],
  update: () => {},
  replace: () => {},
  reset: () => {},
});
export const useSettings = () => useContext(SettingsContext);

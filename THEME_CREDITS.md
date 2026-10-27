# Community theme credits

These are HRig adaptations of community palettes, not official ports or full VS Code extension packages. Core surfaces, syntax tokens, and terminal ANSI colors use the referenced palettes. Secondary workspace shades are derived to fit HRig. All colors ship offline; choosing a theme does not fetch code or contact a theme service.

| Theme | Upstream palette | Revision | License text |
| --- | --- | --- | --- |
| Catppuccin Mocha, Macchiato, Frappe, Latte | [catppuccin/palette](https://github.com/catppuccin/palette/blob/07d02aa110ef9eb7e7427afca5c73ba9cf7f8ebd/palette.json) | 07d02aa110ef | [MIT](assets/theme-licenses/catppuccin.txt) |
| Nord | [nordtheme/nord](https://github.com/nordtheme/nord/blob/1cef71605416a222e57225b544540ce0fcec18d4/src/nord.css) | 1cef71605416 | [MIT](assets/theme-licenses/nord.txt) |
| Dracula Classic | [dracula/visual-studio-code](https://github.com/dracula/visual-studio-code/blob/b50e62e320906d5f57a8bf05fd6ddf23b890d6dd/src/dracula.yml) | b50e62e32090 | [MIT](assets/theme-licenses/dracula.txt) |
| Tokyo Night | [folke/tokyonight.nvim](https://github.com/folke/tokyonight.nvim/blob/cdc07ac78467a233fd62c493de29a17e0cf2b2b6/extras/kitty/tokyonight_night.conf) | cdc07ac78467 | [Apache-2.0](assets/theme-licenses/tokyo.txt) |
| Gruvbox Dark | [gruvbox-community/gruvbox](https://github.com/gruvbox-community/gruvbox/blob/180ad85971343df68be3422a5630fa84e45a9ab2/colors/gruvbox.vim) | 180ad8597134 | [MIT](assets/theme-licenses/gruvbox.txt) |

Catppuccin palette version: 1.8.0. Tokyo Night currently uses Apache-2.0 in its repository; its generated terminal file also carries an MIT header. HRig conservatively bundles the repository license. Gruvbox is adapted from the maintained community fork, credited to Pavel Pertsev and contributors.

License texts and the provenance manifest are bundled with desktop builds. Theme names belong to their respective projects; no endorsement is implied. To update the adaptations deliberately, run node scripts/update-community-themes.mjs and review/test the generated changes before release.

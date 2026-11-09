# Project text search

The search box under Project tools looks for text in the files of the open project. By default it is a literal, case-insensitive search, exactly as before. This page describes the options that can be switched on, the limits that always apply and how the search is kept from freezing the app. The search only reads files: results are shown as a list and are never run, opened as commands or sent to a terminal or seat. There is no setting for any of this.

## Options

- **Regular expression** (the `.*` button): the text is read as a regular expression and matched without regard to case.
- **Whole word** (the `Word` button): the characters just before and just after a match must not be letters, digits or an underscore, in any script. It works with plain text and with a regular expression.
- **Files** (the `Files` button): shows an Include and an Exclude field. Each takes a comma separated list of globs. A file is searched when it matches an include glob (or there is none) and no exclude glob.

With every option off nothing changes: the same files are read in the same order and the same lines match.

## Globs

- Globs are project-relative and use forward slashes. `*` and `?` work inside one name, and a whole segment `**` crosses folders: `src/**/*.ts`.
- A glob without a slash matches a file or folder name at any depth (`*.ts`, `test`, `README.md`). A glob with a slash, or a leading `./`, starts at the project folder (`src/*.ts`, `./docs`). A glob also matches through the folders above a file, so `test` leaves out everything under a folder named test.
- Globs are case-sensitive. Braces and character classes are not supported, so list each glob separately. A leading `!` is refused: use the Exclude field.
- Refused with a message naming the field: absolute paths (a leading `/`, `~` or a drive letter), any `..` segment, backslashes, control characters, more than 20 globs, a glob longer than 200 characters.
- Globs only filter the search. They never add a path to it: folders that are always skipped (`.git`, `node_modules`, `dist`, `.next`, `.venv`, `release`) and symbolic links stay skipped, and files that a glob filters out still count toward the 20,000 file limit.

## Regular expression rules

A pattern is checked before anything is searched, on every connection type. It is refused, with the reason shown in the panel, when it:

- is longer than 200 characters or holds a control character;
- is not valid in the JavaScript Unicode mode;
- uses a backreference, a lookbehind or a named group;
- has an empty character class (`[]` or `[^]`) or a repeat count over 1,000;
- repeats a group without an upper limit (`(ab)+`, `(a|b)*`) or repeats a group that holds alternatives or optional parts (`(a?){3}`, `(a|b){2}`);
- has more than 3 unbounded repeats (`*`, `+`, `{n,}`);
- has more than 10 doubling points, counting each `?`, each alternative `|` and each range `{n,m}` (a range counts the bits of its width).

Examples that work: `TODO\d+`, `foo.*bar`, `^\s*import .* from`, `(foo|bar)baz`, `\w+@\w+\.\w+`. Examples that are refused: `(a+)+$`, `(a|aa)+$`, `(.*a){20}`, `(a)\1`, `(?<=x)y`, `.*.*.*.*x`. The checks are deliberately conservative: some safe patterns are refused too, and rewriting them with fewer repeats or a bounded range such as `\w{1,64}` makes them pass.

## Limits

| Limit                                                    | Value                                      |
| -------------------------------------------------------- | ------------------------------------------ |
| Search text                                              | 300 characters (a regular expression: 200) |
| Matches shown                                            | 200                                        |
| Files visited                                            | 20,000                                     |
| File size                                                | 2 MB; files with a NUL byte are skipped    |
| Folder depth (local)                                     | 25                                         |
| Line shown                                               | 250 characters                             |
| Line tested by a regular expression or whole word search | the first 1,000 characters                 |
| Time                                                     | 10 seconds for the whole search            |

A literal search with no option reads whole lines, however long. When a search stops early the panel says why: the first 200 matches are shown, the 20,000 file limit was reached, or the 10 second budget ran out. The list is then partial, and in the last two cases files that were not reached are not shown. On a very large project at roughly a millisecond per file the time limit can come before the file limit.

## How a runaway pattern is contained

JavaScript and Python regular expressions backtrack, and a hostile pattern on a long line can take very long. Three layers act, in this order.

1. The pre-check above refuses the pattern shapes that grow without bound, and the line limit keeps each test small.
2. The clock is read between files and between lines, so a search ends at the time limit and returns what it has.
3. A pattern that passes but can still be slow (two or more unbounded repeats, or more than three doubling points) is run for each file in a private context with a two second limit (a vm context). When the limit passes, the search stops and says it ran out of time. On a remote connection the Python script sets an alarm for the time budget and abandons a runaway match in the same way where the host supports it (Linux and macOS).

Residual risk, stated plainly: the pre-check is a heuristic, not a proof, and an ordinary pattern still runs on the main process for up to two seconds before the limit stops it. The vm limit has been measured to stop a runaway match on the Node version used for the tests; it was not measured inside the packaged app, and a different engine version could behave differently. On a remote connection a host without the alarm (for example Windows over SSH) relies on the pre-check and on the 25 second limit the app puts on every remote command. Running every search in a separate worker process is a larger change and is not part of this feature.

## Local, WSL and SSH

Local searches run in the app with JavaScript regular expressions (Unicode, case-insensitive). WSL and SSH searches run a Python script on the host with the Python `re` module, case-insensitive. The same pre-check runs first, and the app also refuses what only one engine understands on those connections: `\p{...}` and `\P{...}` property escapes, code point escapes written with braces and `\c` control escapes. The usual syntax (classes, groups, alternatives, `\d \w \s \b`, anchors, lazy repeats) is the same, but a few results differ:

- In Python `\d`, `\w`, `\s` and `\b` also match non-ASCII digits, letters and spaces; in JavaScript they are ASCII only (`\s` also covers a few Unicode spaces).
- Python splits lines at more characters than a line feed (for example form feed and the Unicode line separators), JavaScript only at a line feed or carriage return and line feed.
- Case folding and the exact set of letters and digits behind Whole word follow each engine's Unicode tables and can differ for rare characters.
- A pattern Python cannot compile is reported as an invalid regular expression.

## Not included

Replace in files, grouping matches by file, streaming or cancelling a running search, context lines around a match, and running the search in a worker thread are not part of this feature.

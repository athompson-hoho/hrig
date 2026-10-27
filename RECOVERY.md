# Local drafts and recovery

Open **Tools → Saved drafts and recovery** to inspect or delete saved recovery copies, messages and reviews. HRig shows a startup notice when editor recovery copies exist, including files whose tabs are no longer open. Copies live in `drafts.json` in Electron's user-data directory. They can contain sensitive source code or message text; they are local plaintext, separate from the project and excluded from settings export.

Unsaved editor changes are copied locally as you edit. After a restart, open a recovery file and choose **Restore recovery copy** or **Discard recovery copy**. Until that choice, the editor displays the disk version read-only. Restore changes the in-memory buffer, not the project file. If disk has changed, comparison/reload remains available and saving the old revision is rejected. Save or deliberately discard changes to remove the recovery copy. Recovery is bounded local storage, not a backup service.

**Save All** in the command center saves all dirty buffers known to this app instance, including inactive tabs/workspaces. Each save checks its original disk revision; one conflict does not stop other files from being saved. Failures are summarized and the affected drafts remain. Restoring a copy never launches agents or sends shell commands.

Messages are scoped by connection endpoint, project, rig and seat. Review drafts are scoped by endpoint/project, with each added note bound to the recipient's rig/seat identity and the file revision at note creation. Sending rechecks file revisions and rejects stale notes or a changed recipient. Re-review and remove/re-add stale notes rather than silently attaching them to new code.

A message or review submitted successfully is **accepted by OpenRig**, not confirmed read by the agent. An interrupted or failed send retains its draft and may have an unknown outcome. HRig never automatically resends. Check the recipient before deliberately trying again. Drafts survive panel unmount and restart; they do not queue remote actions.

The shared local store permits 100 records and 20 MB overall, with a 4.5 MB limit per record. Local boards/settings also use records in this store. Storage errors remain visible and the previous good file is preserved if a write fails. **Clear all saved drafts** preserves local board records, and never deletes project files. Active editors and composers may create new copies as you continue editing. Linear API keys use a separate encrypted file and are never included in these draft records.

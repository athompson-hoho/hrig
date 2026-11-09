module.exports = actual => ({
  ...actual,
  acknowledge(view) {
    actual.acknowledge(view);
    // Real exercised registry mutation: the bug would grant changed-disk Save
    // authority by rebasing the protected revision on acknowledgement.
    view.registry.buffers.get(view.props.id).revision = 'synthetic-observed-r2';
  },
});

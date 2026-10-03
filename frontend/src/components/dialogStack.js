const dialogs = [];

export function registerDialog(dialog) {
  dialogs.push(dialog);
  return () => {
    const index = dialogs.lastIndexOf(dialog);
    if (index !== -1) dialogs.splice(index, 1);
  };
}

export function isTopDialog(dialog) {
  return dialogs.at(-1) === dialog;
}

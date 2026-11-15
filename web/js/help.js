// Справка «что тут можно делать»: клавиши, жесты и неочевидные возможности. Реестр без зависимостей:
// каждый модуль сам объявляет свои строки (addHelp), ui.js из них собирает окно «?», подсказку при входе
// в режим и строки «клавиши» внутри разделов панели. Рукописного общего списка нет — он бы устарел.
//
//   addHelp({ mode, topic, keys, text, touch, brief, order }, …)
//     mode  — когда это работает: один из HELP_MODES (порядок групп в окне справки);
//     topic — тема для строки в разделе панели ({ type: 'help', topic } в ui.js), необязательно;
//     keys  — клавиши/кнопки мыши: ['W', 'A', 'S', 'D'] (пусто — это совет без клавиш);
//     text  — что делает, со строчной буквы: «идти»;
//     touch — то же на сенсорном экране (строка), false — на сенсорном не бывает, не задано — как text;
//     brief — показать в короткой подсказке при входе в режим (2–4 строки на режим, самое нужное);
//     order — порядок внутри группы (меньше — выше), по умолчанию 50.
// Модуль может звать addHelp при загрузке: ui.js перечитывает реестр, когда открывает справку.

export const HELP_MODES = [
  { id: 'design', title: 'Смотреть и менять' },
  { id: 'arrange', title: 'Двигать мебель' },
  { id: 'panel',  title: 'Панель' },
  { id: 'walk',   title: 'Прогулка' },
  { id: 'seat',   title: 'Сидя' },
  { id: 'phone',  title: 'Телефон в руке' },
  { id: 'photo',  title: 'Фото-рендер' },
];

export const HELP = [];
export function addHelp(...entries) {
  for (const e of entries.flat()) HELP.push({ order: 50, keys: [], ...e });
}
// Строки режима (или темы) для текущего устройства: на сенсорном — только то, что там работает
export function helpFor({ mode, topic, brief, touch = false } = {}) {
  return HELP
    .filter(e => (!mode || e.mode === mode) && (!topic || e.topic === topic) && (!brief || e.brief) && !(touch && e.touch === false))
    .sort((a, b) => a.order - b.order);
}

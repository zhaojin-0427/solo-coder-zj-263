const { weapons } = require('../store');

function parsePagination(query) {
  const page = parseInt(query.page) || 1;
  const pageSize = parseInt(query.pageSize) || 20;
  return { page, pageSize };
}

function getNestedValue(obj, path) {
  return path.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
}

function applyFilters(list, filters) {
  let result = list;
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === '') continue;
    if (typeof value === 'function') {
      result = result.filter(value);
    } else {
      result = result.filter(item => getNestedValue(item, key) === value);
    }
  }
  return result;
}

function sortByDate(list, dateField, direction = 'desc') {
  const sorted = [...list].sort((a, b) => {
    const ta = new Date(a[dateField]).getTime();
    const tb = new Date(b[dateField]).getTime();
    return direction === 'desc' ? tb - ta : ta - tb;
  });
  return sorted;
}

function paginate(list, page, pageSize) {
  const total = list.length;
  const start = (page - 1) * pageSize;
  const paginated = list.slice(start, start + pageSize);
  return { list: paginated, total, page, pageSize };
}

function attachWeapon(list, weaponIdField = 'weaponId') {
  return list.map(item => ({
    ...item,
    weapon: weapons.get(item[weaponIdField]) || null
  }));
}

function filterByDateRange(list, dateField, startDate, endDate) {
  let result = list;
  if (startDate) {
    const sd = new Date(startDate);
    result = result.filter(item => new Date(item[dateField]) >= sd);
  }
  if (endDate) {
    const ed = new Date(endDate);
    result = result.filter(item => new Date(item[dateField]) <= ed);
  }
  return result;
}

function contains(field, keyword) {
  return item => String(getNestedValue(item, field) || '').includes(keyword);
}

function parseBool(value) {
  return value === 'true' || value === true;
}

function queryList({
  mapData,
  filters = {},
  dateField,
  sortDirection = 'desc',
  withWeapon = false,
  weaponIdField = 'weaponId',
  query
}) {
  const { page, pageSize } = parsePagination(query || {});
  let list = Array.from(mapData.values());
  list = applyFilters(list, filters);
  if (dateField) {
    list = sortByDate(list, dateField, sortDirection);
  }
  if (withWeapon) {
    list = attachWeapon(list, weaponIdField);
  }
  return paginate(list, page, pageSize);
}

module.exports = {
  parsePagination,
  applyFilters,
  sortByDate,
  paginate,
  attachWeapon,
  filterByDateRange,
  queryList,
  contains,
  parseBool
};

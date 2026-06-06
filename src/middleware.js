function unifiedResponse(req, res, next) {
  res.success = (data = null, message = '操作成功', code = 200) => {
    res.status(code).json({ code, message, data });
  };

  res.fail = (message = '操作失败', code = 400, data = null) => {
    res.status(code).json({ code, message, data });
  };

  next();
}

function notFoundHandler(req, res) {
  res.status(404).json({ code: 404, message: '接口不存在', data: null });
}

function errorHandler(err, req, res, next) {
  console.error(err.stack);
  res.status(500).json({ code: 500, message: '服务器内部错误', data: err.message });
}

module.exports = {
  unifiedResponse,
  notFoundHandler,
  errorHandler
};

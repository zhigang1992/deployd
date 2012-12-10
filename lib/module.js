var makeExtendable = require('./util/extendable')
  , _ = require('underscore')
  , async = require('async');

var Module = function Module(id, options) {
  if (typeof id === 'object') {
    options = id;
    id = undefined;
  }
  this.id = id;
  options = options || {};
  this.config = options.config || {};
  this.server = options.server;
  if (typeof this.init === 'function') this.init();
};

Module.prototype.load = function(fn) {
  fn();
};


Module.prototype.add = function(type, item) {
  this[type] = this[type] || [];
  this[type].push(item);
}

Module.prototype.addKey = function(type, item, value) {
  this[type] = this[type] || {};
  if (value === undefined) value = true;
  this[type][item] = value;
}

Module.prototype.addResourceType = function(resourceType) {
  if (!resourceType.id) {
    // Fall back on constructor name
    resourceType.id = resourceType.name;
  }
  this.add('resourceTypes', resourceType);
}

Module.prototype.addResource = function(resource) {
  this.add('resources', resource);
}

Module.prototype.addMiddlewareType = function(type, config) {
  this.addKey('middlewareTypes', type, config);
}

Module.prototype.addMiddleware = function(type, name, middleware, extras) {
  if (typeof name === 'function') {
    extras = middleware;
    middleware = name;
    name = undefined;
  }

  this.middleware = this.middleware || {};
  this.middleware[type] = this.middleware[type] || [];
  this.middleware[type].push(_.extend({
      module: this.id
    , name: name
    , execute: middleware.bind(this)
  }, extras));
}

Module.prototype.executeMiddleware = function(type, args, fn, options) {
  var self = this;
  var stack = self.server.middleware[type];

  options = options || {};
  options.timeout = options.timeout || 2000;  

  if (stack) {
    async.forEachSeries(stack, function(middleware, next) {
      if (options.onTimeout) {
        var completed = false;
        var timeout = setTimeout(function() {
          if (!completed) {
            options.onTimeout(middleware);
          }
        }, middleware.timeout || options.timeout);
      }

      middleware.execute.apply(null, _.union(args, function(err) {
        if (options.onTimeout) {
          clearTimeout(timeout);
          completed = true;
        }
        if (err) return next(err);
        next();
      }));

    }, function(err) {
      if (err) return fn(err);
      fn.apply(null, _.union(null, args));
    });
  } else {
    fn.apply(null, args);
  }
};

makeExtendable(Module);

module.exports = Module;
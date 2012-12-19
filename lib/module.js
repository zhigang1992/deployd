var makeExtendable = require('./util/extendable')
  , _ = require('underscore')
  , async = require('async')
  , util = require('util')
  , EventEmitter = require('events').EventEmitter;

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

util.inherits(Module, EventEmitter);

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

makeExtendable(Module);

module.exports = Module;
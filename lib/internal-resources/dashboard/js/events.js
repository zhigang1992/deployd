$(document).ready(function() {

  var $eventEditor = $('#event-editor')
    , $aceEditor
    , editor
    , currentEvent
    , events = {}
    , tabs = []
    , timeout
    , tabsTemplate;


  if (Context.events && $eventEditor && $eventEditor.is('.default-editor')) {
    var template = _.template($('#event-editor-template').html());
    tabsTemplate = _.template($('#event-tabs-template').html());
    $eventEditor.html(template({ events: Context.events }));

    $eventEditor.find('.more-events-link').dropdown();

    $eventEditor.show();

    $aceEditor = $('#event-ace-editor');

    $eventEditor.on('click', '.event-link', onClickEventLink);

    createEditor();
  }

  function createEditor() {
  
    editor = ace.edit('event-ace-editor');
    editor.setTheme("ace/theme/deployd");
    editor.session.setMode("ace/mode/javascript");
    editor.setShowPrintMargin(false);

    bindEditor();
    renderTabs();
  }

  function bindEditor() {
    editor.getSession().on('change', function() { trackUpdate() } );      
    editor.commands.addCommand({
        name: "save",
        bindKey: {win: "Ctrl-S", mac: "Command-S"},
        exec: function(editor) {
          update();
        }
    });

    if (location.hash) {
      switchToEvent(location.hash.replace('#', ''));
    } else {
      switchToEvent(Context.events[0]);
    }
  }

  function renderTabs() {
    $eventEditor.find('.nav-tabs > li:not(.more-events)').remove();
    $eventEditor.find('.nav-tabs').prepend(tabsTemplate({
      tabs: tabs,
      currentEvent: currentEvent
    }));
  }

  function switchToEvent(eventName) {
    $aceEditor.hide();

    update(); // Force a save

    loadEvent(eventName, function(code) {
      editor.getSession().setValue(code);
      $aceEditor.show();

      currentEvent = eventName;
      location.hash = eventName;

      if (!_(tabs).contains(eventName)) {
        tabs.push(eventName);
        tabs = _(tabs).last(5); // Only the maximum 5
      }

      renderTabs();

      setTimeout(function() {
        editor.resize();
      }, 1);
    });
  }

  function loadEvent(eventName, callback) {
    if (events.hasOwnProperty(eventName)) {
      callback(events[eventName]);
    } else {
      var fileName = eventName.toLowerCase() + '.js';
      dpd('__resources').get(Context.resourceId + '/' + fileName, function(res, err) {
        var code = res && res.value || "";
        events[eventName] = code;
        callback(code);
      });
    }
  }

  function trackUpdate() {
    if (timeout) {
      clearTimeout(timeout);
    }

    timeout = setTimeout(function() {
      update();
    }, 1000);
  }

  function update() {
    var put = { value: editor.getSession().getValue() };

    if (!currentEvent || put.value === events[currentEvent]) return;

    var fileName = currentEvent.toLowerCase() + '.js';

    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }    

    events[currentEvent] = put.value;

    dpd('__resources').put(Context.resourceId + '/' + fileName, put, function(res, err) {
      if (err) { return ui.error("Error saving event", err.message).effect('slide'); }
      if (!$('#notifications li').length) ui.notify("Saved").hide(1000).effect('slide');
    });
  }

  function onClickEventLink(e) {
    var eventName = $(e.currentTarget).attr('data-event');

    switchToEvent(eventName);
  }

});
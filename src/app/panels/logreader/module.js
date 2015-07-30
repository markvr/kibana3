/** @scratch /panels/5
 *
 * include::panels/table.asciidoc[]
 */

/** @scratch /panels/table/0
 *
 * == table
 * Status: *Stable*
 *
 * The table panel contains a sortable, pagable view of documents that. It can be arranged into
 * defined columns and offers several interactions, such as performing adhoc terms aggregations.
 *
 */
define([
  'angular',
  'app',
  'lodash',
  'kbn',
  'moment',
],
function (angular, app, _, kbn, moment) {
  'use strict';

  var module = angular.module('kibana.panels.logreader', []);
  app.useModule(module);

  module.controller('logreader', function($rootScope, $scope, $modal, $q, $compile, fields, querySrv, dashboard, filterSrv) {
    $scope.panelMeta = {
      modals : [
        {
          description: "Inspect",
          icon: "icon-info-sign",
          partial: "app/partials/inspector.html",
          show: $scope.panel.spyable
        }
      ],
      editorTabs : [
        {
          title:'Queries',
          src: 'app/partials/querySelect.html'
        }
      ],
      status: "Stable",
      description: "A paginated table of records matching your query or queries. Click on a row to "+
        "expand it and review all of the fields associated with that document. <p>"
    };

    // Set and populate defaults
    var _d = {
      /** @scratch /panels/table/5
       * === Parameters
       *
       * size:: The number of hits to show per page
       */
      loadSize    : 1000, // Per page
      /** @scratch /panels/table/5
       * pages:: The number of pages available
       */
     
      timeField: '@timestamp',
      /** @scratch /panels/table/5
       * spyable:: Set to false to disable the inspect icon
       */
      spyable : true,
      /** @scratch /panels/table/5
       *
       * ==== Queries
       * queries object:: This object describes the queries to use on this panel.
       * queries.mode::: Of the queries available, which to use. Options: +all, pinned, unpinned, selected+
       * queries.ids::: In +selected+ mode, which query ids are selected.
       */
      queries     : {
        mode        : 'all',
        ids         : []
      },
      style   : {'font-size': '9pt'},
      normTimes : true,
    };
    _.defaults($scope.panel,_d);

    var currentOffsets = {"top":null, "middle":null, "bottom":null};

    $scope.init = function () {
      $scope.$on('refresh',function(){$scope.get_data();});
      $scope.get_data();
    };


    $scope.set_sort = function(field) {
      if($scope.panel.sort[0] === field) {
        $scope.panel.sort[1] = $scope.panel.sort[1] === 'asc' ? 'desc' : 'asc';
      } else {
        $scope.panel.sort[0] = field;
      }
      $scope.get_data();
    };

    $scope.toggle_field = function(field) {
      if (_.indexOf($scope.panel.fields,field) > -1) {
        $scope.panel.fields = _.without($scope.panel.fields,field);
        delete $scope.columns[field];
      } else {
        $scope.panel.fields.push(field);
        $scope.columns[field] = true;
      }
    };

    $scope.toggle_highlight = function(field) {
      if (_.indexOf($scope.panel.highlight,field) > -1) {
        $scope.panel.highlight = _.without($scope.panel.highlight,field);
      } else {
        $scope.panel.highlight.push(field);
      }
    };

    $scope.pick_line = function(row) {

    };

    $scope.goto = function(position) {
      if (position === 'start') {
        $scope.set_offset(0);
      } else {
        // The version of elastic.js bundled with Kibana doesn't support aggregations, so the only way to get the max
        // offset is to search by offset desc with a size of 1.  Ugly :(
        var filters = [];
        var filterCount = 0;
        var endOffset = 0;
        var request = $scope.ejs.Request().indices(dashboard.indices);

        _.each(filterSrv.list, function(filterProps ) {
        if (filterProps.field === "file.raw" || filterProps.field === "host.raw") { // The host and filename
          filters.push($scope.ejs.TermFilter(filterProps.field, filterProps.value));
          filterCount++;
          }
        });
        var boolFilter = $scope.ejs.BoolFilter();
        boolFilter.must(filters);
        var filteredQuery = $scope.ejs.FilteredQuery(
          $scope.ejs.QueryStringQuery("*"),
          boolFilter
        )

        request = request.query(
          filteredQuery
        ).size(1).sort("offset", "desc");
        request.doSearch().then(function(results) {
          endOffset = results.hits.hits[0]._source.offset;
          $scope.set_offset(endOffset - $scope.panel.loadSize + 1000);
        });
      }
    };

    $scope.set_offset = function(offset) {
      _.each(filterSrv.list, function(filterProps ) {
      if (filterProps.field === "offset") {
        filterSrv.remove(filterProps.id, true);
        filterSrv.set({type:'terms', field:"offset", value:offset, mandate:('must'), active:false});
      }
      });
    };

    $scope.get_data = function(position) {
      if (typeof position === "undefined") position = "middle";
      // Given a row, we want to return all entries in the same file, defined by hostname, file & date
      var
        request,
        boolQuery;
        

      $scope.panel.error =  false;

      $scope.panelMeta.loading = true;

      // Make sure we have everything for the request to complete
      if(dashboard.indices.length === 0) {
        return;
      }

      request = $scope.ejs.Request().indices(dashboard.indices);
      
      $scope.panel.queries.ids = querySrv.idsByMode($scope.panel.queries);

      var filters = [];
      var filterCount = 0;
      _.each(filterSrv.list, function(filterProps ) {
        if (filterProps.field === "@timestamp") { // Keep the timestamp field
          filters.push(filterSrv.getEjsObj(filterProps.id))
        } else if (filterProps.field === "file.raw" || filterProps.field === "host.raw") { // The host and filename
          // filterSrv.getEjsObj() returns false if the filter is in-active, so we need to manually create it ourselves
          filters.push($scope.ejs.TermFilter(filterProps.field, filterProps.value));
          filterCount++;
        } else if (filterProps.field === "offset") { // and an ugly way to calculate the offset
          filterCount++;
          var rangeFilter = $scope.ejs.RangeFilter("offset");
          var searchOffsets = {"top":null, "bottom": null};
          switch (position) {
            case "top" :
              searchOffsets.bottom = currentOffsets.top;
              currentOffsets.top = currentOffsets.top - $scope.panel.loadSize;
              searchOffsets.top = currentOffsets.top;
              if (currentOffsets.top < 0) currentOffsets.top = 0;
              break;
            case "middle":
              currentOffsets.middle = parseInt(filterProps.value);
              currentOffsets.top = currentOffsets.middle - $scope.panel.loadSize;
              currentOffsets.bottom = currentOffsets.middle + $scope.panel.loadSize;
              searchOffsets.top = currentOffsets.top;
              searchOffsets.bottom = currentOffsets.bottom;
              break;
            case "bottom":
              searchOffsets.top = currentOffsets.bottom;
              currentOffsets.bottom = currentOffsets.bottom + $scope.panel.loadSize;
              searchOffsets.bottom = currentOffsets.bottom;
              break;

          }

          rangeFilter.gte(searchOffsets.top );
          rangeFilter.lte(searchOffsets.bottom);
          filters.push(rangeFilter);
        }
      });

      if (filterCount === 3) {
        var boolFilter = $scope.ejs.BoolFilter();
        boolFilter.must(filters);
        var filteredQuery = $scope.ejs.FilteredQuery(
          $scope.ejs.QueryStringQuery("*"),
          boolFilter
        );

        request = request.query(
          filteredQuery
        )
          .size(1000)
          .sort("offset");

        // Populate scope when we have results
        request.doSearch().then(function(results) {
          $scope.panelMeta.loading = false;
          // Check for error and abort if found
          if(!(_.isUndefined(results.error))) {
            $scope.panel.error = $scope.parse_error(results.error);
            return;
          }
           switch (position) {
            case "top" :
              $scope.data = results.hits.hits.concat($scope.data);
              break;
            case "middle":
              $scope.data = results.hits.hits;
              
              break;
            case "bottom":
              $scope.data = $scope.data.concat(results.hits.hits);
              break;
          }
        });
    } else {
        console.log("not enough filters, need exactly 3");
        $scope.panelMeta.loading = false;
        $scope.data = [];
      }
    };


    $scope.isSelected = function(offset) {
      return offset===currentOffsets.middle;
    };

    $scope.page = function(page) {
      $scope.panel.offset = page*$scope.panel.size;
      $scope.get_data();
    };

    $scope.build_search = function(field,value,negate) {
      var query;
      // This needs to be abstracted somewhere
      if(_.isArray(value)) {
        query = "(" + _.map(value,function(v){return angular.toJson(v);}).join(" AND ") + ")";
      } else if (_.isUndefined(value)) {
        query = '*';
        negate = !negate;
      } else {
        query = angular.toJson(value);
      }
      $scope.panel.offset = 0;
      filterSrv.set({type:'field',field:field,query:query,mandate:(negate ? 'mustNot':'must')});
    };

    $scope.fieldExists = function(field,mandate) {
      filterSrv.set({type:'exists',field:field,mandate:mandate});
    };

   

    $scope.set_refresh = function (state) {
      $scope.refresh = state;
    };

    $scope.close_edit = function() {
      if($scope.refresh) {
        $scope.get_data();
      }
      $scope.columns = [];
      _.each($scope.panel.fields,function(field) {
        $scope.columns[field] = true;
      });
      $scope.refresh =  false;
    };

    $scope.locate = function(obj, path) {
      path = path.split('.');
      var arrayPattern = /(.+)\[(\d+)\]/;
      for (var i = 0; i < path.length; i++) {
        var match = arrayPattern.exec(path[i]);
        if (match) {
          obj = obj[match[1]][parseInt(match[2],10)];
        } else {
          obj = obj[path[i]];
        }
      }
      return obj;
    };


  });

  // This also escapes some xml sequences
  module.filter('tableHighlight', function() {
    return function(text) {
      if (!_.isUndefined(text) && !_.isNull(text) && text.toString().length > 0) {
        return text.toString().
          replace(/&/g, '&amp;').
          replace(/</g, '&lt;').
          replace(/>/g, '&gt;').
          replace(/\r?\n/g, '<br/>').
          replace(/@start-highlight@/g, '<code class="highlight">').
          replace(/@end-highlight@/g, '</code>');
      }
      return '';
    };
  });

  module.filter('tableTruncate', function() {
    return function(text,length,factor) {
      if (!_.isUndefined(text) && !_.isNull(text) && text.toString().length > 0) {
        return text.length > length/factor ? text.substr(0,length/factor)+'...' : text;
      }
      return '';
    };
  });



  module.filter('tableJson', function() {
    var json;
    return function(text,prettyLevel) {
      if (!_.isUndefined(text) && !_.isNull(text) && text.toString().length > 0) {
        json = angular.toJson(text,prettyLevel > 0 ? true : false);
        json = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        if(prettyLevel > 1) {
          /* jshint maxlen: false */
          json = json.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, function (match) {
            var cls = 'number';
            if (/^"/.test(match)) {
              if (/:$/.test(match)) {
                cls = 'key strong';
              } else {
                cls = '';
              }
            } else if (/true|false/.test(match)) {
              cls = 'boolean';
            } else if (/null/.test(match)) {
              cls = 'null';
            }
            return '<span class="' + cls + '">' + match + '</span>';
          });
        }
        return json;
      }
      return '';
    };
  });

  // WIP
  module.filter('tableLocalTime', function(){
    return function(text,event) {
      return moment(event.sort[1]).format("YYYY-MM-DDTHH:mm:ss.SSSZ");
    };
  });

});

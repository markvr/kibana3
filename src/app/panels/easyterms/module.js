/** 
 * A panel that uses "tags" added to the logs to provide an easy way to drill down into logs
 *
 * "Tags" are simply log fields prefixed with a given text and an integer increment.  e.g. a prefix of "tag_",
 * uses a list of fields called "tag_0", "tag_1" etc.
 *
 * Tags should have a logical hierarchy in the log domain.  They are then displayed in columns in the panel, i.e.
 * column 0 lists all distinct values for tag_0.  When an entry in column 0 is selected, then column 1 lists all
 * distinct values for log entries that have tag_0 == the selected entry in column 0.  It's simpler than it sounds!
 *
 */
define([
  'angular',
  'app',
  'lodash',
  'jquery',
  'kbn'
],
function (angular, app, _, $, kbn) {
  'use strict';

  var module = angular.module('kibana.panels.easyterms', []);
  app.useModule(module);

  module.controller('easyterms', function($scope, querySrv, dashboard, filterSrv, $q) {
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
        {title:'Queries', src:'app/partials/querySelect.html'}
      ],
      status  : "Stable",
      description : "Displays the results of an elasticsearch facet as a pie chart, bar chart, or a "+
        "table"
    };

    // Set and populate defaults
    var _d = {
      field   : 'tag_',   // Default tag prefix
      order   : 'term',
      style   : { "font-size": '10pt'},
      spyable     : true,
      /** @scratch /panels/terms/5
       * ==== Queries
       * queries object:: This object describes the queries to use on this panel.
       * queries.mode::: Of the queries available, which to use. Options: +all, pinned, unpinned, selected+
       * queries.ids::: In +selected+ mode, which query ids are selected.
       */
      queries     : {
        mode        : 'all',
        ids         : []
      },
    };

    _.defaults($scope.panel,_d);  // Set the defaults onto the panel
    
 
    // Array to hold a sequence of objects defining terms that have been selected.
    // selectedTerm = {filterSrvId : <id>, term: term}
    var selectedTerm = null;
    
    $scope.init = function () {
      $scope.hits = 0;

      // Used in case we are loading from a saved configuration that contains selected tags
      // Iterate over the existing filters, and find any that match our term tag field.  If they do,
      // then add them to the selectedTerms list.
      _.each(filterSrv.list, function(filter) {
        if (typeof filter.field !== "undefined" && filter.field.indexOf($scope.panel.field) !== -1) {
          selectedTerm = {"filterSrvId":filter.id, "term": {"label" : filter.value}};
        }
      });

      $scope.$on('refresh',function(){
        $scope.get_data();
      });

      $scope.get_data();
    };


    $scope.isSelected = function(term) {
      if (selectedTerm !== null && selectedTerm.term.label === term.label) {
        return true;
      } else {
        return false;
      }
    }

  /**
   * Refreshes $scope.data, which is bound to the view.
   * @returns {nothing}
   */
    $scope.get_data = function() { 
          
      // Array to hold the results of the queries.
      // $scope.data = [{ label : v.term, count : v.count},...]
      // ];
      $scope.data = [];

      // Make the panel "loading" icon spin.
      $scope.panelMeta.loading = true;

      var field  = $scope.panel.field; // e.g. "tag_0"

      if(dashboard.indices.length === 0) {
        return;
      }

      var request, boolQuery, queries;

      request = $scope.ejs.Request().indices(dashboard.indices);

      // This gets the *queries* - entries in the search box etc.  Taken from "terms" module.js
      $scope.panel.queries.ids = querySrv.idsByMode($scope.panel.queries);
      queries = querySrv.getQueryObjs($scope.panel.queries.ids);
      boolQuery = $scope.ejs.BoolQuery();
      _.each(queries,function(q) {
        boolQuery = boolQuery.should(querySrv.toEjsObj(q));
      });


      // Now the *filters* - these are more complex because we need to build them up in turn for each level.
      // Get a list of filter IDs with no selectedTerm filters, i.e. filters that we aren't managing
      var filterIds;
      if (selectedTerm !== null) {
        filterIds = _.difference(filterSrv.ids, [selectedTerm.filterSrvId]);
      } else {
        filterIds = filterSrv.ids;
      }

      var filters = filterSrv.getBoolFilter(filterIds);

      // Configure the ejs request
      request.facet($scope.ejs.TermsFacet('terms')
        .field(field)
        .size($scope.panel.size)
        .order($scope.panel.order)
//        .exclude($scope.panel.exclude)
        .facetFilter($scope.ejs.QueryFilter(
          $scope.ejs.FilteredQuery(
            boolQuery,
            filters
          )
        ))
      ).size(0);

      // Populate the inspector panel
      $scope.inspector = angular.toJson(JSON.parse(request.toString()),true);

      var results = request.doSearch();

      // Using promises, so that we only update the panel when *all* the ajax requests we've fired have returned.
      // We also get the results in the order they were sent, *not* the order they return which is important.
      results.then(function(result) {
//        var selectedTermToRemove ;
        if (result.facets.terms.terms.length > 0) {
          $scope.data = [];
          _.each(result.facets.terms.terms, function(v) {
            $scope.data.push({ label : v.term, count : v.count});
          });
        } else {
          // If we have no results, then either there are no more tag levels to go (i.e. the queried tag doesn't exist)
          // or the time range has been moved so there are no results with the selected terms in the new time range.
          // We're not at the end, so time range has moved - remove selectedTerm
          if (selectedTerm !== null) {
            filterSrv.remove(selectedTerm.filterSrvId, true);
          }
          selectedTerm = null;
//          selectedTermToRemove = selectedTerm;
        }
//        selectedTermsList = _.difference(selectedTerm, selectedTermToRemove);
        $scope.$emit('render');
        $scope.panelMeta.loading = false;
      });
      
    };

  /**
   * Given a search term and tag level, add to the filter by concatenating the level to the field name (defined when 
   * the panel was created), and setting that to the term.  e.g. for {term = "webfarm", level = 0}, add a filter of
   * "$scope.panel.field_0 == "webfarm"
   * @param {string} term The term (i.e. word) that to add to the filter
   * @param {integer} level The level we are at
   * @returns {nothing}
   */
    $scope.build_search = function(term) {
      if (selectedTerm !== null) {
        filterSrv.remove(selectedTerm.filterSrvId, true);
      }
      if (selectedTerm === null || selectedTerm.term.label !== term.label) {
        selectedTerm = {};
        selectedTerm.term = term;
        selectedTerm.filterSrvId =  filterSrv.set({type:'terms', field:$scope.panel.field, value:term.label, mandate:('must')});
      } else {
        selectedTerm = null;
      }

      dashboard.refresh();
    };

    $scope.set_refresh = function (state) {
      $scope.refresh = state;
    };

    $scope.close_edit = function() {
      if($scope.refresh) {
        $scope.get_data();
      }
      $scope.refresh =  false;
      $scope.$emit('render');
    };

    $scope.showMeta = function(term) {
      if(_.isUndefined(term.meta)) {
        return true;
      }
      if(term.meta === 'other' && !$scope.panel.other) {
        return false;
      }
      if(term.meta === 'missing' && !$scope.panel.missing) {
        return false;
      }
      return true;
    };

  });

  
});